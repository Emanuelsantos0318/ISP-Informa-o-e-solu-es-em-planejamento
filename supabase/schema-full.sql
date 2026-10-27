


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."adjustment_direction" AS ENUM (
    'increase',
    'decrease'
);


ALTER TYPE "public"."adjustment_direction" OWNER TO "postgres";


CREATE TYPE "public"."profile_role" AS ENUM (
    'admin',
    'stock_manager',
    'operator',
    'purchasing_approver',
    'viewer'
);


ALTER TYPE "public"."profile_role" OWNER TO "postgres";


CREATE TYPE "public"."purchase_plan_status" AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'ordered',
    'partially_received',
    'received',
    'cancelled'
);


ALTER TYPE "public"."purchase_plan_status" OWNER TO "postgres";


CREATE TYPE "public"."record_status" AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE "public"."record_status" OWNER TO "postgres";


CREATE TYPE "public"."stock_movement_type" AS ENUM (
    'entry',
    'exit',
    'adjustment',
    'loss'
);


ALTER TYPE "public"."stock_movement_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_profile"("p_company_id" "uuid", "p_target_unit_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles as manager
    join public.companies as company
      on company.id = manager.company_id
    where manager.user_id = (select auth.uid())
      and manager.company_id = p_company_id
      and manager.role = 'admin'
      and manager.status = 'active'
      and company.status = 'active'
      and (manager.unit_id is null or manager.unit_id = p_target_unit_id)
      and (
        p_target_unit_id is null
        or exists (
          select 1
          from public.units as target_unit
          where target_unit.id = p_target_unit_id
            and target_unit.company_id = p_company_id
            and target_unit.status = 'active'
        )
      )
      and (
        manager.unit_id is null
        or exists (
          select 1
          from public.units as manager_unit
          where manager_unit.id = manager.unit_id
            and manager_unit.company_id = manager.company_id
            and manager_unit.status = 'active'
        )
      )
  );
$$;


ALTER FUNCTION "private"."can_manage_profile"("p_company_id" "uuid", "p_target_unit_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."has_active_access"("p_company_id" "uuid", "p_unit_id" "uuid" DEFAULT NULL::"uuid", "p_allowed_roles" "public"."profile_role"[] DEFAULT NULL::"public"."profile_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles as profile
    join public.companies as company
      on company.id = profile.company_id
    where profile.user_id = (select auth.uid())
      and profile.company_id = p_company_id
      and profile.status = 'active'
      and company.status = 'active'
      and (p_allowed_roles is null or profile.role = any (p_allowed_roles))
      and (
        p_unit_id is null
        or profile.unit_id is null
        or profile.unit_id = p_unit_id
      )
      and (
        profile.unit_id is null
        or exists (
          select 1
          from public.units as assigned_unit
          where assigned_unit.id = profile.unit_id
            and assigned_unit.company_id = profile.company_id
            and assigned_unit.status = 'active'
        )
      )
      and (
        p_unit_id is null
        or exists (
          select 1
          from public.units as requested_unit
          where requested_unit.id = p_unit_id
            and requested_unit.company_id = p_company_id
            and requested_unit.status = 'active'
        )
      )
  );
$$;


ALTER FUNCTION "private"."has_active_access"("p_company_id" "uuid", "p_unit_id" "uuid", "p_allowed_roles" "public"."profile_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_assign_profile"("p_user_id" "uuid", "p_company_id" "uuid", "p_unit_id" "uuid", "p_full_name" "text", "p_role" "public"."profile_role", "p_status" "public"."record_status" DEFAULT 'active'::"public"."record_status") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_old_company_id uuid;
  v_old_role public.profile_role;
  v_old_status public.record_status;
  v_action text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Administrators cannot change their own profile.';
  end if;

  if not private.can_manage_profile(p_company_id, p_unit_id) then
    raise exception using errcode = '42501', message = 'Not authorized to manage profiles in this scope.';
  end if;

  if p_full_name is null or length(trim(p_full_name)) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Full name must contain 1 to 160 characters.';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'Unsupported profile status.';
  end if;

  if not exists (select 1 from auth.users as auth_user where auth_user.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The Auth user does not exist.';
  end if;

  select profile.company_id, profile.role, profile.status
    into v_old_company_id, v_old_role, v_old_status
  from public.profiles as profile
  where profile.user_id = p_user_id;

  if found and v_old_company_id <> p_company_id then
    raise exception using errcode = '42501', message = 'A profile cannot be moved to another company.';
  end if;

  if found then
    v_action := 'profile_updated';
    update public.profiles
    set unit_id = p_unit_id,
        full_name = trim(p_full_name),
        role = p_role,
        status = p_status,
        updated_at = now()
    where user_id = p_user_id;
  else
    v_action := 'profile_assigned';
    insert into public.profiles (user_id, company_id, unit_id, full_name, role, status)
    values (p_user_id, p_company_id, p_unit_id, trim(p_full_name), p_role, p_status);
  end if;

  insert into public.audit_logs (
    company_id, unit_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_company_id,
    p_unit_id,
    (select auth.uid()),
    v_action,
    'profile',
    p_user_id,
    jsonb_build_object(
      'old_role', v_old_role,
      'new_role', p_role,
      'old_status', v_old_status,
      'new_status', p_status
    )
  );
end;
$$;


ALTER FUNCTION "public"."admin_assign_profile"("p_user_id" "uuid", "p_company_id" "uuid", "p_unit_id" "uuid", "p_full_name" "text", "p_role" "public"."profile_role", "p_status" "public"."record_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_immutable_row_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Rows in % are append-only', TG_TABLE_NAME;
end;
$$;


ALTER FUNCTION "public"."prevent_immutable_row_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_stock_movement"("p_product_id" "uuid", "p_stock_location_id" "uuid", "p_movement_type" "public"."stock_movement_type", "p_quantity" numeric, "p_idempotency_key" "uuid", "p_product_lot_id" "uuid" DEFAULT NULL::"uuid", "p_adjustment_direction" "public"."adjustment_direction" DEFAULT NULL::"public"."adjustment_direction", "p_note" "text" DEFAULT NULL::"text") RETURNS TABLE("movement_id" "uuid", "balance_quantity" numeric, "replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_actor_id uuid := (select auth.uid());
  v_company_id uuid;
  v_unit_id uuid;
  v_product_status public.record_status;
  v_location_status public.record_status;
  v_balance_id uuid;
  v_balance numeric(14, 3) := 0;
  v_next_balance numeric(14, 3);
  v_delta numeric(14, 3);
  v_movement_id uuid;
  v_existing public.stock_movements%rowtype;
  v_note text := nullif(trim(p_note), '');
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity, 3)
     or p_quantity > 99999999999.999 then
    raise exception using errcode = '22023', message = 'Quantity must be positive with at most three decimal places.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Idempotency key is required.';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'Note cannot exceed 500 characters.';
  end if;
  if (p_movement_type = 'adjustment') <> (p_adjustment_direction is not null) then
    raise exception using errcode = '22023', message = 'Adjustment direction is required only for adjustments.';
  end if;

  select product.company_id, location.unit_id, product.status, location.status
    into v_company_id, v_unit_id, v_product_status, v_location_status
  from public.products as product
  join public.stock_locations as location
    on location.company_id = product.company_id
  where product.id = p_product_id
    and location.id = p_stock_location_id;

  if not found then
    raise exception using errcode = '22023', message = 'Product and stock location must belong to the same company.';
  end if;
  if v_product_status <> 'active' or v_location_status <> 'active' then
    raise exception using errcode = '22023', message = 'Product and stock location must be active.';
  end if;

  if not private.has_active_access(
    v_company_id,
    v_unit_id,
    array['admin', 'stock_manager', 'operator']::public.profile_role[]
  ) then
    raise exception using errcode = '42501', message = 'Not authorized to record stock movements in this scope.';
  end if;

  if p_product_lot_id is not null and not exists (
    select 1 from public.product_lots as lot
    where lot.id = p_product_lot_id
      and lot.company_id = v_company_id
      and lot.unit_id = v_unit_id
      and lot.product_id = p_product_id
  ) then
    raise exception using errcode = '22023', message = 'Lot must match the product and unit.';
  end if;

  -- Serialize identical idempotency keys before checking/replaying the command.
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || p_idempotency_key::text, 0));
  select movement.* into v_existing
  from public.stock_movements as movement
  where movement.company_id = v_company_id
    and movement.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.performed_by <> v_actor_id
       or v_existing.product_id <> p_product_id
       or v_existing.stock_location_id <> p_stock_location_id
       or v_existing.product_lot_id is distinct from p_product_lot_id
       or v_existing.movement_type <> p_movement_type
       or v_existing.adjustment_direction is distinct from p_adjustment_direction
       or v_existing.quantity <> p_quantity
       or v_existing.note is distinct from v_note then
      raise exception using errcode = '22023', message = 'Idempotency key was already used for a different command.';
    end if;

    select balance.quantity into v_balance
    from public.stock_balances as balance
    where balance.product_id = p_product_id
      and balance.stock_location_id = p_stock_location_id
      and balance.product_lot_id is not distinct from p_product_lot_id;
    return query select v_existing.id, coalesce(v_balance, 0), true;
    return;
  end if;

  if p_movement_type = 'entry'
     or (p_movement_type = 'adjustment' and p_adjustment_direction = 'increase') then
    v_delta := p_quantity;
  else
    v_delta := -p_quantity;
  end if;

  -- The advisory lock also protects the no-row-yet case, where FOR UPDATE has nothing to lock.
  perform pg_advisory_xact_lock(hashtextextended(
    p_product_id::text || ':' || p_stock_location_id::text || ':' || coalesce(p_product_lot_id::text, 'no-lot'), 1
  ));

  select balance.id, balance.quantity
    into v_balance_id, v_balance
  from public.stock_balances as balance
  where balance.product_id = p_product_id
    and balance.stock_location_id = p_stock_location_id
    and balance.product_lot_id is not distinct from p_product_lot_id
  for update;
  v_balance := coalesce(v_balance, 0);
  v_next_balance := v_balance + v_delta;

  if v_next_balance < 0 then
    raise exception using errcode = '23514', message = 'Insufficient stock for this movement.';
  end if;

  if v_balance_id is null then
    insert into public.stock_balances (
      company_id, unit_id, product_id, stock_location_id, product_lot_id, quantity
    ) values (
      v_company_id, v_unit_id, p_product_id, p_stock_location_id, p_product_lot_id, v_next_balance
    ) returning id into v_balance_id;
  else
    update public.stock_balances
    set quantity = v_next_balance, updated_at = now()
    where id = v_balance_id;
  end if;

  insert into public.stock_movements (
    company_id, unit_id, product_id, stock_location_id, product_lot_id,
    movement_type, adjustment_direction, quantity, idempotency_key, note, performed_by
  ) values (
    v_company_id, v_unit_id, p_product_id, p_stock_location_id, p_product_lot_id,
    p_movement_type, p_adjustment_direction, p_quantity, p_idempotency_key, v_note, v_actor_id
  ) returning id into v_movement_id;

  insert into public.audit_logs (
    company_id, unit_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_company_id, v_unit_id, v_actor_id, 'stock_movement_created', 'stock_movement', v_movement_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'stock_location_id', p_stock_location_id,
      'product_lot_id', p_product_lot_id,
      'movement_type', p_movement_type,
      'adjustment_direction', p_adjustment_direction,
      'quantity', p_quantity,
      'balance_after', v_next_balance
    )
  );

  return query select v_movement_id, v_next_balance, false;
end;
$$;


ALTER FUNCTION "public"."record_stock_movement"("p_product_id" "uuid", "p_stock_location_id" "uuid", "p_movement_type" "public"."stock_movement_type", "p_quantity" numeric, "p_idempotency_key" "uuid", "p_product_lot_id" "uuid", "p_adjustment_direction" "public"."adjustment_direction", "p_note" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid",
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_logs_action_check" CHECK ((("length"(TRIM(BOTH FROM "action")) >= 1) AND ("length"(TRIM(BOTH FROM "action")) <= 100))),
    CONSTRAINT "audit_logs_entity_type_check" CHECK ((("length"(TRIM(BOTH FROM "entity_type")) >= 1) AND ("length"(TRIM(BOTH FROM "entity_type")) <= 100))),
    CONSTRAINT "audit_logs_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."audit_logs"."actor_id" IS 'Authenticated application actor. NULL is reserved for privileged owner bootstrap/system events; anon and authenticated cannot write audit rows directly.';



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categories_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 120)))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "companies_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 160)))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "lot_number" "text" NOT NULL,
    "expires_on" "date",
    "received_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_lots_lot_number_check" CHECK ((("length"(TRIM(BOTH FROM "lot_number")) >= 1) AND ("length"(TRIM(BOTH FROM "lot_number")) <= 100)))
);


ALTER TABLE "public"."product_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "preferred_supplier_id" "uuid",
    "sku" "text" NOT NULL,
    "name" "text" NOT NULL,
    "barcode" "text",
    "unit_of_measure" "text" NOT NULL,
    "minimum_stock" numeric(14,3) DEFAULT 0 NOT NULL,
    "desired_stock" numeric(14,3),
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_desired_stock_check" CHECK ((("desired_stock" IS NULL) OR ("desired_stock" >= (0)::numeric))),
    CONSTRAINT "products_minimum_stock_check" CHECK (("minimum_stock" >= (0)::numeric)),
    CONSTRAINT "products_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 200))),
    CONSTRAINT "products_sku_check" CHECK ((("length"(TRIM(BOTH FROM "sku")) >= 1) AND ("length"(TRIM(BOTH FROM "sku")) <= 80))),
    CONSTRAINT "products_unit_of_measure_check" CHECK ((("length"(TRIM(BOTH FROM "unit_of_measure")) >= 1) AND ("length"(TRIM(BOTH FROM "unit_of_measure")) <= 30)))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid",
    "full_name" "text" NOT NULL,
    "role" "public"."profile_role" DEFAULT 'viewer'::"public"."profile_role" NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_full_name_check" CHECK ((("length"(TRIM(BOTH FROM "full_name")) >= 1) AND ("length"(TRIM(BOTH FROM "full_name")) <= 160)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_plan_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "purchase_plan_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "suggested_quantity" numeric(14,3) NOT NULL,
    "requested_quantity" numeric(14,3),
    "approved_quantity" numeric(14,3),
    "unit_price_estimate" numeric(14,4),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_plan_items_approved_quantity_check" CHECK ((("approved_quantity" IS NULL) OR ("approved_quantity" > (0)::numeric))),
    CONSTRAINT "purchase_plan_items_requested_quantity_check" CHECK ((("requested_quantity" IS NULL) OR ("requested_quantity" > (0)::numeric))),
    CONSTRAINT "purchase_plan_items_suggested_quantity_check" CHECK (("suggested_quantity" > (0)::numeric)),
    CONSTRAINT "purchase_plan_items_unit_price_estimate_check" CHECK ((("unit_price_estimate" IS NULL) OR ("unit_price_estimate" >= (0)::numeric)))
);


ALTER TABLE "public"."purchase_plan_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "status" "public"."purchase_plan_status" DEFAULT 'draft'::"public"."purchase_plan_status" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_plans_check" CHECK ((("approved_at" IS NULL) = ("approved_by" IS NULL))),
    CONSTRAINT "purchase_plans_title_check" CHECK ((("length"(TRIM(BOTH FROM "title")) >= 1) AND ("length"(TRIM(BOTH FROM "title")) <= 180)))
);


ALTER TABLE "public"."purchase_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_balances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "stock_location_id" "uuid" NOT NULL,
    "product_lot_id" "uuid",
    "quantity" numeric(14,3) DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_balances_quantity_check" CHECK (("quantity" >= (0)::numeric))
);


ALTER TABLE "public"."stock_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_locations_code_check" CHECK ((("length"(TRIM(BOTH FROM "code")) >= 1) AND ("length"(TRIM(BOTH FROM "code")) <= 40))),
    CONSTRAINT "stock_locations_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 160)))
);


ALTER TABLE "public"."stock_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "stock_location_id" "uuid" NOT NULL,
    "product_lot_id" "uuid",
    "movement_type" "public"."stock_movement_type" NOT NULL,
    "adjustment_direction" "public"."adjustment_direction",
    "quantity" numeric(14,3) NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "note" "text",
    "performed_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_movements_check" CHECK ((("movement_type" = 'adjustment'::"public"."stock_movement_type") = ("adjustment_direction" IS NOT NULL))),
    CONSTRAINT "stock_movements_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "contact_name" "text",
    "email" "text",
    "phone" "text",
    "notes" "text",
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "suppliers_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 180)))
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "units_code_check" CHECK ((("length"(TRIM(BOTH FROM "code")) >= 1) AND ("length"(TRIM(BOTH FROM "code")) <= 40))),
    CONSTRAINT "units_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 160)))
);


ALTER TABLE "public"."units" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_company_id_name_key" UNIQUE ("company_id", "name");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_id_company_id_key" UNIQUE ("id", "company_id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_lots"
    ADD CONSTRAINT "product_lots_company_id_unit_id_product_id_lot_number_key" UNIQUE ("company_id", "unit_id", "product_id", "lot_number");



ALTER TABLE ONLY "public"."product_lots"
    ADD CONSTRAINT "product_lots_id_company_id_unit_id_product_id_key" UNIQUE ("id", "company_id", "unit_id", "product_id");



ALTER TABLE ONLY "public"."product_lots"
    ADD CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_company_id_barcode_key" UNIQUE ("company_id", "barcode");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_company_id_sku_key" UNIQUE ("company_id", "sku");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_id_company_id_key" UNIQUE ("id", "company_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."purchase_plan_items"
    ADD CONSTRAINT "purchase_plan_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_plan_items"
    ADD CONSTRAINT "purchase_plan_items_purchase_plan_id_product_id_key" UNIQUE ("purchase_plan_id", "product_id");



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_id_company_id_unit_id_key" UNIQUE ("id", "company_id", "unit_id");



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_locations"
    ADD CONSTRAINT "stock_locations_company_id_unit_id_code_key" UNIQUE ("company_id", "unit_id", "code");



ALTER TABLE ONLY "public"."stock_locations"
    ADD CONSTRAINT "stock_locations_id_company_id_unit_id_key" UNIQUE ("id", "company_id", "unit_id");



ALTER TABLE ONLY "public"."stock_locations"
    ADD CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_company_id_idempotency_key_key" UNIQUE ("company_id", "idempotency_key");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_company_id_name_key" UNIQUE ("company_id", "name");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_id_company_id_key" UNIQUE ("id", "company_id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_company_id_code_key" UNIQUE ("company_id", "code");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_id_company_id_key" UNIQUE ("id", "company_id");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_scope_history_idx" ON "public"."audit_logs" USING "btree" ("company_id", "unit_id", "occurred_at" DESC);



CREATE INDEX "product_lots_expiry_idx" ON "public"."product_lots" USING "btree" ("company_id", "unit_id", "expires_on");



CREATE INDEX "products_category_idx" ON "public"."products" USING "btree" ("company_id", "category_id");



CREATE INDEX "products_company_status_name_idx" ON "public"."products" USING "btree" ("company_id", "status", "name");



CREATE INDEX "profiles_company_unit_status_idx" ON "public"."profiles" USING "btree" ("company_id", "unit_id", "status");



CREATE INDEX "purchase_plan_items_plan_idx" ON "public"."purchase_plan_items" USING "btree" ("purchase_plan_id");



CREATE INDEX "purchase_plans_scope_status_idx" ON "public"."purchase_plans" USING "btree" ("company_id", "unit_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "stock_balances_product_location_lot_uidx" ON "public"."stock_balances" USING "btree" ("product_id", "stock_location_id", COALESCE("product_lot_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX "stock_balances_scope_idx" ON "public"."stock_balances" USING "btree" ("company_id", "unit_id", "product_id");



CREATE INDEX "stock_locations_scope_idx" ON "public"."stock_locations" USING "btree" ("company_id", "unit_id", "status");



CREATE INDEX "stock_movements_product_history_idx" ON "public"."stock_movements" USING "btree" ("company_id", "product_id", "created_at" DESC);



CREATE INDEX "stock_movements_scope_history_idx" ON "public"."stock_movements" USING "btree" ("company_id", "unit_id", "created_at" DESC);



CREATE INDEX "suppliers_company_status_name_idx" ON "public"."suppliers" USING "btree" ("company_id", "status", "name");



CREATE INDEX "units_company_status_idx" ON "public"."units" USING "btree" ("company_id", "status");



CREATE OR REPLACE TRIGGER "audit_logs_append_only" BEFORE DELETE OR UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_immutable_row_mutation"();



CREATE OR REPLACE TRIGGER "stock_movements_append_only" BEFORE DELETE OR UPDATE ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_immutable_row_mutation"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_lots"
    ADD CONSTRAINT "product_lots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_lots"
    ADD CONSTRAINT "product_lots_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "public"."products"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_lots"
    ADD CONSTRAINT "product_lots_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "public"."categories"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_preferred_supplier_id_company_id_fkey" FOREIGN KEY ("preferred_supplier_id", "company_id") REFERENCES "public"."suppliers"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_plan_items"
    ADD CONSTRAINT "purchase_plan_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plan_items"
    ADD CONSTRAINT "purchase_plan_items_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "public"."products"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plan_items"
    ADD CONSTRAINT "purchase_plan_items_purchase_plan_id_company_id_unit_id_fkey" FOREIGN KEY ("purchase_plan_id", "company_id", "unit_id") REFERENCES "public"."purchase_plans"("id", "company_id", "unit_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plan_items"
    ADD CONSTRAINT "purchase_plan_items_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_supplier_id_company_id_fkey" FOREIGN KEY ("supplier_id", "company_id") REFERENCES "public"."suppliers"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_plans"
    ADD CONSTRAINT "purchase_plans_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "public"."products"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_product_lot_id_company_id_unit_id_product_i_fkey" FOREIGN KEY ("product_lot_id", "company_id", "unit_id", "product_id") REFERENCES "public"."product_lots"("id", "company_id", "unit_id", "product_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_stock_location_id_company_id_unit_id_fkey" FOREIGN KEY ("stock_location_id", "company_id", "unit_id") REFERENCES "public"."stock_locations"("id", "company_id", "unit_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_locations"
    ADD CONSTRAINT "stock_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_locations"
    ADD CONSTRAINT "stock_locations_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "public"."products"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_product_lot_id_company_id_unit_id_product__fkey" FOREIGN KEY ("product_lot_id", "company_id", "unit_id", "product_id") REFERENCES "public"."product_lots"("id", "company_id", "unit_id", "product_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_stock_location_id_company_id_unit_id_fkey" FOREIGN KEY ("stock_location_id", "company_id", "unit_id") REFERENCES "public"."stock_locations"("id", "company_id", "unit_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_unit_id_company_id_fkey" FOREIGN KEY ("unit_id", "company_id") REFERENCES "public"."units"("id", "company_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_select_authorized_roles" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("private"."has_active_access"("company_id", "unit_id", ARRAY['admin'::"public"."profile_role"]) OR (("entity_type" = ANY (ARRAY['stock_movement'::"text", 'stock_balance'::"text", 'product_lot'::"text"])) AND "private"."has_active_access"("company_id", "unit_id", ARRAY['stock_manager'::"public"."profile_role"])) OR (("entity_type" = ANY (ARRAY['purchase_plan'::"text", 'purchase_plan_item'::"text"])) AND "private"."has_active_access"("company_id", "unit_id", ARRAY['purchasing_approver'::"public"."profile_role"]))));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_manage_catalog" ON "public"."categories" TO "authenticated" USING ("private"."has_active_access"("company_id", NULL::"uuid", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"])) WITH CHECK ("private"."has_active_access"("company_id", NULL::"uuid", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"]));



CREATE POLICY "categories_select_active_members" ON "public"."categories" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", NULL::"uuid", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_select_active_members" ON "public"."companies" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("id", NULL::"uuid", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."product_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_lots_select_active_members" ON "public"."product_lots" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_manage_catalog" ON "public"."products" TO "authenticated" USING ("private"."has_active_access"("company_id", NULL::"uuid", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"])) WITH CHECK ("private"."has_active_access"("company_id", NULL::"uuid", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"]));



CREATE POLICY "products_select_active_members" ON "public"."products" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", NULL::"uuid", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self_or_scoped_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "private"."can_manage_profile"("company_id", "unit_id")));



ALTER TABLE "public"."purchase_plan_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchase_plan_items_select_active_members" ON "public"."purchase_plan_items" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."purchase_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchase_plans_select_active_members" ON "public"."purchase_plans" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."stock_balances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_balances_select_active_members" ON "public"."stock_balances" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."stock_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_locations_manage_catalog" ON "public"."stock_locations" TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"])) WITH CHECK ("private"."has_active_access"("company_id", "unit_id", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"]));



CREATE POLICY "stock_locations_select_active_members" ON "public"."stock_locations" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_movements_select_active_members" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "unit_id", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "suppliers_manage_catalog" ON "public"."suppliers" TO "authenticated" USING ("private"."has_active_access"("company_id", NULL::"uuid", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"])) WITH CHECK ("private"."has_active_access"("company_id", NULL::"uuid", ARRAY['admin'::"public"."profile_role", 'stock_manager'::"public"."profile_role"]));



CREATE POLICY "suppliers_select_active_members" ON "public"."suppliers" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", NULL::"uuid", NULL::"public"."profile_role"[]));



ALTER TABLE "public"."units" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "units_select_active_members" ON "public"."units" FOR SELECT TO "authenticated" USING ("private"."has_active_access"("company_id", "id", NULL::"public"."profile_role"[]));



GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."can_manage_profile"("p_company_id" "uuid", "p_target_unit_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_profile"("p_company_id" "uuid", "p_target_unit_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."has_active_access"("p_company_id" "uuid", "p_unit_id" "uuid", "p_allowed_roles" "public"."profile_role"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."has_active_access"("p_company_id" "uuid", "p_unit_id" "uuid", "p_allowed_roles" "public"."profile_role"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_assign_profile"("p_user_id" "uuid", "p_company_id" "uuid", "p_unit_id" "uuid", "p_full_name" "text", "p_role" "public"."profile_role", "p_status" "public"."record_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_assign_profile"("p_user_id" "uuid", "p_company_id" "uuid", "p_unit_id" "uuid", "p_full_name" "text", "p_role" "public"."profile_role", "p_status" "public"."record_status") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_assign_profile"("p_user_id" "uuid", "p_company_id" "uuid", "p_unit_id" "uuid", "p_full_name" "text", "p_role" "public"."profile_role", "p_status" "public"."record_status") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prevent_immutable_row_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_immutable_row_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_stock_movement"("p_product_id" "uuid", "p_stock_location_id" "uuid", "p_movement_type" "public"."stock_movement_type", "p_quantity" numeric, "p_idempotency_key" "uuid", "p_product_lot_id" "uuid", "p_adjustment_direction" "public"."adjustment_direction", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_stock_movement"("p_product_id" "uuid", "p_stock_location_id" "uuid", "p_movement_type" "public"."stock_movement_type", "p_quantity" numeric, "p_idempotency_key" "uuid", "p_product_lot_id" "uuid", "p_adjustment_direction" "public"."adjustment_direction", "p_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."record_stock_movement"("p_product_id" "uuid", "p_stock_location_id" "uuid", "p_movement_type" "public"."stock_movement_type", "p_quantity" numeric, "p_idempotency_key" "uuid", "p_product_lot_id" "uuid", "p_adjustment_direction" "public"."adjustment_direction", "p_note" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."categories" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."categories" TO "authenticated";



GRANT ALL ON TABLE "public"."companies" TO "service_role";
GRANT SELECT ON TABLE "public"."companies" TO "authenticated";



GRANT ALL ON TABLE "public"."product_lots" TO "service_role";
GRANT SELECT ON TABLE "public"."product_lots" TO "authenticated";



GRANT ALL ON TABLE "public"."products" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."products" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."purchase_plan_items" TO "service_role";
GRANT SELECT ON TABLE "public"."purchase_plan_items" TO "authenticated";



GRANT ALL ON TABLE "public"."purchase_plans" TO "service_role";
GRANT SELECT ON TABLE "public"."purchase_plans" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_balances" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_balances" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_locations" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_locations" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."suppliers" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."suppliers" TO "authenticated";



GRANT ALL ON TABLE "public"."units" TO "service_role";
GRANT SELECT ON TABLE "public"."units" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







