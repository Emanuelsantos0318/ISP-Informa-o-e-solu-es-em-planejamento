BEGIN;

-- Permite relacionar uma conta a várias unidades sem alterar o vínculo principal
-- usado por versões antigas do aplicativo.
CREATE TABLE public.profile_unit_access (
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, unit_id),
  FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE CASCADE
);

INSERT INTO public.profile_unit_access (user_id, company_id, unit_id)
SELECT user_id, company_id, unit_id FROM public.profiles WHERE unit_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.profile_unit_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_unit_access_select ON public.profile_unit_access FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.can_manage_profile(company_id, unit_id)
  );
REVOKE INSERT, UPDATE, DELETE ON public.profile_unit_access FROM anon, authenticated;
GRANT SELECT ON public.profile_unit_access TO authenticated;

-- Histórico próprio de autenticações. A interface grava apenas o horário e o
-- agente do navegador; endereço IP não fica disponível no cliente.
CREATE TABLE public.user_access_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  unit_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX user_access_history_user_time_idx
  ON public.user_access_history (company_id, user_id, occurred_at DESC);
ALTER TABLE public.user_access_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_access_history_admin_read ON public.user_access_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS target_profile
      WHERE target_profile.user_id = user_access_history.user_id
        AND target_profile.company_id = user_access_history.company_id
        AND (
          private.can_manage_profile(target_profile.company_id, target_profile.unit_id)
          OR EXISTS (
            SELECT 1 FROM public.profile_unit_access AS target_access
            WHERE target_access.user_id = target_profile.user_id
              AND target_access.company_id = target_profile.company_id
              AND private.can_manage_profile(target_access.company_id, target_access.unit_id)
          )
        )
    )
  );
REVOKE ALL ON public.user_access_history FROM anon, authenticated;
GRANT SELECT ON public.user_access_history TO authenticated;

CREATE OR REPLACE FUNCTION private.can_manage_profile(
  p_company_id uuid,
  p_target_unit_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS manager
    JOIN public.companies AS company ON company.id = manager.company_id
    WHERE manager.user_id = (SELECT auth.uid())
      AND manager.company_id = p_company_id
      AND manager.role IN ('admin', 'super_admin')
      AND manager.status = 'active'
      AND company.status = 'active'
      AND (
        manager.role = 'super_admin' OR manager.unit_id IS NULL
        OR manager.unit_id = p_target_unit_id
        OR EXISTS (
          SELECT 1 FROM public.profile_unit_access AS access
          WHERE access.user_id = manager.user_id
            AND access.company_id = manager.company_id
            AND access.unit_id = p_target_unit_id
        )
      )
      AND (
        p_target_unit_id IS NULL OR EXISTS (
          SELECT 1 FROM public.units AS target_unit
          WHERE target_unit.id = p_target_unit_id
            AND target_unit.company_id = p_company_id
            AND target_unit.status = 'active'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.has_active_access(
  p_company_id uuid,
  p_unit_id uuid DEFAULT NULL,
  p_allowed_roles public.profile_role[] DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN public.companies AS company ON company.id = profile.company_id
    WHERE profile.user_id = (SELECT auth.uid())
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
      AND company.status = 'active'
      AND (profile.role = 'super_admin' OR p_allowed_roles IS NULL OR profile.role = ANY(p_allowed_roles))
      AND (
        p_unit_id IS NULL OR profile.role = 'super_admin' OR profile.unit_id IS NULL
        OR profile.unit_id = p_unit_id
        OR EXISTS (
          SELECT 1 FROM public.profile_unit_access AS access
          WHERE access.user_id = profile.user_id
            AND access.company_id = profile.company_id
            AND access.unit_id = p_unit_id
        )
      )
      AND (
        profile.role = 'super_admin' OR profile.unit_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.units AS assigned_unit
          WHERE assigned_unit.id = profile.unit_id
            AND assigned_unit.company_id = profile.company_id
            AND assigned_unit.status = 'active'
        )
      )
      AND (
        p_unit_id IS NULL OR profile.role = 'super_admin' OR EXISTS (
          SELECT 1 FROM public.units AS requested_unit
          WHERE requested_unit.id = p_unit_id
            AND requested_unit.company_id = p_company_id
            AND requested_unit.status = 'active'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_access(
  p_user_id uuid,
  p_company_id uuid,
  p_unit_ids uuid[],
  p_full_name text,
  p_role public.profile_role,
  p_status public.record_status
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_role public.profile_role;
  v_old_role public.profile_role;
  v_old_status public.record_status;
  v_primary_unit uuid;
  v_unit uuid;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles
  WHERE user_id = (SELECT auth.uid()) AND company_id = p_company_id AND status = 'active';
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active administrator required.';
  END IF;
  IF p_user_id = (SELECT auth.uid()) OR p_role = 'super_admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This profile cannot be changed by this operation.';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) NOT BETWEEN 1 AND 160
     OR p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid profile data.';
  END IF;

  SELECT role, status INTO v_old_role, v_old_status FROM public.profiles
  WHERE user_id = p_user_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'User profile not found.'; END IF;
  IF NOT private.can_manage_profile(p_company_id, (SELECT unit_id FROM public.profiles WHERE user_id = p_user_id))
     OR EXISTS (
       SELECT 1 FROM public.profile_unit_access AS target_access
       WHERE target_access.user_id = p_user_id AND target_access.company_id = p_company_id
         AND NOT private.can_manage_profile(p_company_id, target_access.unit_id)
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'The user has access outside your administration scope.';
  END IF;

  IF p_unit_ids IS NULL THEN
    IF NOT private.can_manage_profile(p_company_id, NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Company-wide access requires company administrator permission.';
    END IF;
    v_primary_unit := NULL;
  ELSE
    IF cardinality(p_unit_ids) = 0 OR cardinality(p_unit_ids) > 100
       OR cardinality(p_unit_ids) <> (SELECT count(DISTINCT item) FROM unnest(p_unit_ids) AS item) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select one or more unique active units.';
    END IF;
    FOREACH v_unit IN ARRAY p_unit_ids LOOP
      IF NOT private.can_manage_profile(p_company_id, v_unit) OR NOT EXISTS (
        SELECT 1 FROM public.units WHERE id = v_unit AND company_id = p_company_id AND status = 'active'
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'One or more units are outside your administration scope.';
      END IF;
    END LOOP;
    v_primary_unit := p_unit_ids[1];
  END IF;

  UPDATE public.profiles SET unit_id = v_primary_unit, full_name = trim(p_full_name),
    role = p_role, status = p_status, updated_at = now()
  WHERE user_id = p_user_id AND company_id = p_company_id;
  DELETE FROM public.profile_unit_access WHERE user_id = p_user_id AND company_id = p_company_id;
  IF p_unit_ids IS NOT NULL THEN
    INSERT INTO public.profile_unit_access(user_id, company_id, unit_id)
    SELECT p_user_id, p_company_id, item FROM unnest(p_unit_ids) AS item;
  END IF;
  INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_company_id, v_primary_unit, (SELECT auth.uid()), 'profile_updated', 'profile', p_user_id,
    jsonb_build_object('old_role', v_old_role, 'new_role', p_role,
      'old_status', v_old_status, 'new_status', p_status,
      'unit_ids', CASE WHEN p_unit_ids IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_unit_ids) END));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_own_access_event(p_user_agent text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.'; END IF;
  INSERT INTO public.user_access_history(company_id, user_id, unit_id, user_agent)
  SELECT company_id, user_id, unit_id, left(p_user_agent, 500)
  FROM public.profiles WHERE user_id = v_user_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active profile required.'; END IF;
  DELETE FROM public.user_access_history
  WHERE id IN (
    SELECT id FROM public.user_access_history
    WHERE user_id = v_user_id
    ORDER BY occurred_at DESC
    OFFSET 200
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_access(uuid,uuid,uuid[],text,public.profile_role,public.record_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_access(uuid,uuid,uuid[],text,public.profile_role,public.record_status) TO authenticated;
REVOKE ALL ON FUNCTION public.record_own_access_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_own_access_event(text) TO authenticated;

COMMIT;
