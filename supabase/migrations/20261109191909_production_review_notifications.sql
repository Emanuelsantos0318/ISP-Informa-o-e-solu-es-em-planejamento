BEGIN;

-- Persiste quem enviou o plano para revisão e quem o aprovou.
ALTER TABLE public.production_plans
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN submitted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN review_feedback text;

ALTER TABLE public.production_plans
  ADD CONSTRAINT production_plans_review_feedback_check
  CHECK (review_feedback IS NULL OR length(review_feedback) <= 1000);

-- A caixa guarda notificações privadas por usuário e unidade.
CREATE TABLE public.production_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_code text NOT NULL CHECK (event_code IN (
    'plan_submitted', 'plan_approved', 'plan_changes_requested',
    'plan_started', 'plan_finished'
  )),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 600),
  href text NOT NULL DEFAULT '/planejamento-producao',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_notifications_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.production_plans(id, company_id, unit_id) ON DELETE CASCADE,
  CONSTRAINT production_notifications_event_recipient_key
    UNIQUE (event_id, recipient_user_id)
);

CREATE INDEX production_notifications_inbox_idx
  ON public.production_notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX production_notifications_plan_idx
  ON public.production_notifications (company_id, unit_id, plan_id, created_at DESC);

ALTER TABLE public.production_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.production_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (read_at) ON TABLE public.production_notifications TO authenticated;
GRANT ALL ON TABLE public.production_notifications TO service_role;

CREATE POLICY production_notifications_read_own
  ON public.production_notifications FOR SELECT TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND private.has_active_access(company_id, unit_id, NULL::public.profile_role[])
  );
CREATE POLICY production_notifications_mark_own_read
  ON public.production_notifications FOR UPDATE TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND read_at IS NULL
    AND private.has_active_access(company_id, unit_id, NULL::public.profile_role[])
  )
  WITH CHECK (
    recipient_user_id = (SELECT auth.uid())
    AND read_at IS NOT NULL
    AND private.has_active_access(company_id, unit_id, NULL::public.profile_role[])
  );

-- O cliente só pode mudar o status chamando a transição validada abaixo.
CREATE OR REPLACE FUNCTION private.guard_production_plan_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.review_feedback IS DISTINCT FROM OLD.review_feedback THEN
    IF current_setting('isp.production_plan_transition', true)
       IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Use the authorized production plan transition.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_production_plan_transition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER production_plans_transition_guard
  BEFORE UPDATE ON public.production_plans
  FOR EACH ROW EXECUTE FUNCTION private.guard_production_plan_transition();

-- Admins globais também podem encerrar um plano; a validação segue no banco.
CREATE OR REPLACE FUNCTION private.guard_production_plan_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'finished'
       AND NOT private.has_active_access(OLD.company_id, OLD.unit_id, ARRAY['admin', 'super_admin']::public.profile_role[]) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Finished production plans require administrator access to change.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'finished' AND OLD.status <> 'finished'
       AND NOT private.has_active_access(NEW.company_id, NEW.unit_id, ARRAY['admin', 'stock_manager', 'super_admin']::public.profile_role[]) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an administrator or stock manager can finish a production plan.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Workflow atômico: valida papel e mapa, muda status, grava auditoria e avisa os responsáveis.
CREATE OR REPLACE FUNCTION public.transition_production_plan(
  p_plan_id uuid,
  p_action text,
  p_feedback text DEFAULT NULL
)
RETURNS TABLE (new_status text, notification_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan public.production_plans%ROWTYPE;
  v_actor uuid := auth.uid();
  v_actor_role public.profile_role;
  v_next_status text;
  v_event_code text;
  v_title text;
  v_message text;
  v_event_id uuid := gen_random_uuid();
  v_notifications integer := 0;
  v_has_content boolean;
  v_has_pending boolean;
  v_previous_transition text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required.';
  END IF;

  SELECT plan.* INTO v_plan
  FROM public.production_plans AS plan
  WHERE plan.id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Production plan not found.';
  END IF;

  SELECT profile.role INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.user_id = v_actor
    AND profile.company_id = v_plan.company_id
    AND profile.status = 'active';
  IF v_actor_role IS NULL OR NOT private.has_active_access(
    v_plan.company_id, v_plan.unit_id,
    ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver', 'super_admin']::public.profile_role[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No active access to this production plan.';
  END IF;

  IF p_action IN ('submit_for_review', 'approve') THEN
    SELECT
      EXISTS (
        SELECT 1 FROM public.production_plan_entries AS entry
        WHERE entry.plan_id = v_plan.id
      ) OR EXISTS (
        SELECT 1 FROM public.production_hortifruti_entries AS entry
        WHERE entry.plan_id = v_plan.id
      ) OR EXISTS (
        SELECT 1 FROM public.production_pulp_entries AS entry
        WHERE entry.plan_id = v_plan.id
      ),
      EXISTS (
        SELECT 1 FROM public.production_plan_entries AS entry
        WHERE entry.plan_id = v_plan.id
          AND (entry.consumption_date IS NULL OR length(trim(coalesce(entry.meal_group, ''))) = 0
            OR entry.final_quantity IS NULL OR entry.quantity_unit IS NULL)
      ) OR EXISTS (
        SELECT 1 FROM public.production_hortifruti_entries AS entry
        WHERE entry.plan_id = v_plan.id
          AND (entry.quantity IS NULL OR length(trim(entry.quantity_unit)) = 0)
      ) OR EXISTS (
        SELECT 1 FROM public.production_pulp_entries AS entry
        WHERE entry.plan_id = v_plan.id
          AND (entry.consumption_date IS NULL OR entry.quantity IS NULL
            OR entry.quantity_unit IS NULL OR entry.service_code IS NULL
            OR (entry.flavor_id IS NULL AND length(trim(coalesce(entry.original_flavor_text, ''))) = 0))
      )
    INTO v_has_content, v_has_pending;
    IF NOT v_has_content THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Add at least one production, Hortifruti, or pulp item before review.';
    END IF;
    IF v_has_pending THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Resolve missing dates, groups, quantities, units, or pulp services before review.';
    END IF;
  END IF;

  IF p_action = 'submit_for_review' THEN
    IF v_plan.status NOT IN ('draft', 'filling') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only a plan being filled can be submitted for review.';
    END IF;
    v_next_status := 'review';
    v_event_code := 'plan_submitted';
    v_title := 'Planejamento aguardando revisão';
    v_message := v_plan.title || ' foi enviado para revisão.';
  ELSIF p_action = 'approve' THEN
    IF v_actor_role NOT IN ('admin', 'stock_manager', 'super_admin') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an administrator or stock manager can approve a plan.';
    END IF;
    IF v_plan.status <> 'review' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only a plan under review can be approved.';
    END IF;
    v_next_status := 'approved';
    v_event_code := 'plan_approved';
    v_title := 'Planejamento aprovado';
    v_message := v_plan.title || ' foi aprovado e está pronto para execução.';
  ELSIF p_action = 'request_changes' THEN
    IF v_actor_role NOT IN ('admin', 'stock_manager', 'super_admin') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an administrator or stock manager can request changes.';
    END IF;
    IF v_plan.status <> 'review' OR length(trim(coalesce(p_feedback, ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A review comment is required to return the plan.';
    END IF;
    IF length(trim(p_feedback)) > 1000 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Review comment exceeds 1000 characters.';
    END IF;
    v_next_status := 'filling';
    v_event_code := 'plan_changes_requested';
    v_title := 'Planejamento devolvido para ajuste';
    v_message := v_plan.title || ': ' || trim(p_feedback);
  ELSIF p_action = 'start' THEN
    IF v_plan.status <> 'approved' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only an approved plan can start execution.';
    END IF;
    v_next_status := 'in_progress';
    v_event_code := 'plan_started';
    v_title := 'Execução do planejamento iniciada';
    v_message := v_plan.title || ' entrou em execução.';
  ELSIF p_action = 'finish' THEN
    IF v_actor_role NOT IN ('admin', 'stock_manager', 'super_admin') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an administrator or stock manager can finish a plan.';
    END IF;
    IF v_plan.status <> 'in_progress' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only a plan in progress can be finished.';
    END IF;
    v_next_status := 'finished';
    v_event_code := 'plan_finished';
    v_title := 'Planejamento concluído';
    v_message := v_plan.title || ' foi concluído.';
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported production plan action.';
  END IF;

  v_previous_transition := current_setting('isp.production_plan_transition', true);
  PERFORM pg_catalog.set_config('isp.production_plan_transition', v_plan.id::text, true);
  UPDATE public.production_plans AS plan
  SET status = v_next_status,
      submitted_at = CASE WHEN p_action = 'submit_for_review' THEN now() ELSE plan.submitted_at END,
      submitted_by = CASE WHEN p_action = 'submit_for_review' THEN v_actor ELSE plan.submitted_by END,
      approved_at = CASE WHEN p_action = 'approve' THEN now() ELSE plan.approved_at END,
      approved_by = CASE WHEN p_action = 'approve' THEN v_actor ELSE plan.approved_by END,
      review_feedback = CASE WHEN p_action = 'request_changes' THEN trim(p_feedback) ELSE NULL END,
      updated_by = v_actor,
      updated_at = now()
  WHERE plan.id = v_plan.id;
  -- Limpa a autorização logo após a atualização para que ela não possa
  -- autorizar outro UPDATE na mesma transação que chamou esta RPC.
  PERFORM pg_catalog.set_config(
    'isp.production_plan_transition',
    coalesce(v_previous_transition, ''),
    true
  );

  INSERT INTO public.production_notifications (
    event_id, company_id, unit_id, plan_id, recipient_user_id,
    event_code, title, message, href
  )
  SELECT v_event_id, v_plan.company_id, v_plan.unit_id, v_plan.id,
         profile.user_id, v_event_code, v_title, v_message,
         '/planejamento-producao?planId=' || v_plan.id::text
  FROM public.profiles AS profile
  WHERE profile.company_id = v_plan.company_id
    AND profile.status = 'active'
    AND profile.user_id <> v_actor
    AND (profile.unit_id = v_plan.unit_id OR profile.unit_id IS NULL)
    AND (
      (p_action = 'submit_for_review' AND profile.role IN ('admin', 'stock_manager', 'super_admin'))
      OR (p_action = 'approve' AND (profile.user_id = v_plan.created_by OR profile.role = 'operator'))
      OR (p_action = 'request_changes' AND profile.user_id = v_plan.created_by)
      OR (p_action IN ('start', 'finish') AND profile.user_id = v_plan.created_by)
    );
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  RETURN QUERY SELECT v_next_status, v_notifications;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_production_plan(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_production_plan(uuid, text, text) TO authenticated;

-- Após o envio para revisão, os dados do mapa ficam bloqueados até eventual devolução.
DROP POLICY production_plan_entries_manage_operations ON public.production_plan_entries;
CREATE POLICY production_plan_entries_manage_operations
  ON public.production_plan_entries FOR ALL TO authenticated
  USING (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND EXISTS (
      SELECT 1 FROM public.production_plans AS plan
      WHERE plan.id = plan_id AND plan.status IN ('draft', 'filling')
    )
  )
  WITH CHECK (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND EXISTS (
      SELECT 1 FROM public.production_plans AS plan
      WHERE plan.id = plan_id AND plan.status IN ('draft', 'filling')
    )
  );

DROP POLICY production_pulp_entries_manage_operations ON public.production_pulp_entries;
CREATE POLICY production_pulp_entries_manage_operations
  ON public.production_pulp_entries FOR ALL TO authenticated
  USING (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND EXISTS (
      SELECT 1 FROM public.production_plans AS plan
      WHERE plan.id = plan_id AND plan.status IN ('draft', 'filling')
    )
  )
  WITH CHECK (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND EXISTS (
      SELECT 1 FROM public.production_plans AS plan
      WHERE plan.id = plan_id AND plan.status IN ('draft', 'filling')
    )
  );

DROP POLICY production_hortifruti_entries_manage_operations ON public.production_hortifruti_entries;
CREATE POLICY production_hortifruti_entries_manage_operations
  ON public.production_hortifruti_entries FOR ALL TO authenticated
  USING (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND EXISTS (
      SELECT 1 FROM public.production_plans AS plan
      WHERE plan.id = plan_id AND plan.status IN ('draft', 'filling')
    )
  )
  WITH CHECK (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND EXISTS (
      SELECT 1 FROM public.production_plans AS plan
      WHERE plan.id = plan_id AND plan.status IN ('draft', 'filling')
    )
  );

COMMENT ON TABLE public.production_notifications IS
  'Notificações privadas de revisão e execução do planejamento de produção, endereçadas a usuários autorizados da unidade.';
COMMENT ON FUNCTION public.transition_production_plan(uuid, text, text) IS
  'Valida transições de planejamento de produção, bloqueia edição após envio e notifica os usuários autorizados.';

COMMIT;
