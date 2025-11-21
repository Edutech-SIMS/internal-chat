

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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."allowance_frequency" AS ENUM (
    'monthly',
    'termly',
    'yearly',
    'one-time'
);


ALTER TYPE "public"."allowance_frequency" OWNER TO "postgres";


CREATE TYPE "public"."app_role" AS ENUM (
    'superadmin',
    'admin',
    'teacher',
    'parent',
    'student',
    'accountant',
    'other_staff',
    'driver',
    'librarian',
    'nurse',
    'security_guard',
    'janitor',
    'system_admin',
    'vehicle_assistant'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."crud_operation" AS ENUM (
    'create',
    'read',
    'update',
    'delete'
);


ALTER TYPE "public"."crud_operation" OWNER TO "postgres";


CREATE TYPE "public"."loan_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'active',
    'completed',
    'defaulted'
);


ALTER TYPE "public"."loan_status" OWNER TO "postgres";


CREATE TYPE "public"."loan_type" AS ENUM (
    'personal',
    'emergency',
    'education',
    'development',
    'advance_salary'
);


ALTER TYPE "public"."loan_type" OWNER TO "postgres";


CREATE TYPE "public"."mobile_money_provider" AS ENUM (
    'mtn',
    'vodafone',
    'airteltigo'
);


ALTER TYPE "public"."mobile_money_provider" OWNER TO "postgres";


CREATE TYPE "public"."payment_method_type" AS ENUM (
    'bank_transfer',
    'mobile_money',
    'cash'
);


ALTER TYPE "public"."payment_method_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'processing',
    'paid',
    'failed'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."payroll_period_status" AS ENUM (
    'draft',
    'processing',
    'completed',
    'cancelled',
    'processed',
    'approved',
    'closed'
);


ALTER TYPE "public"."payroll_period_status" OWNER TO "postgres";


CREATE TYPE "public"."payroll_period_type" AS ENUM (
    'monthly',
    'termly'
);


ALTER TYPE "public"."payroll_period_type" OWNER TO "postgres";


CREATE TYPE "public"."permission_request_status" AS ENUM (
    'pending',
    'approved',
    'denied'
);


ALTER TYPE "public"."permission_request_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_custom_permissions"("target_user_id" "uuid", "enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  admin_school_id uuid;
  target_school_id uuid;
BEGIN
  -- Get admin's school
  SELECT school_id INTO admin_school_id
  FROM public.profiles
  WHERE user_id = auth.uid();
  
  -- Get target user's school
  SELECT school_id INTO target_school_id
  FROM public.profiles
  WHERE user_id = target_user_id;
  
  -- Check if admin has permission
  IF NOT (
    has_role(auth.uid(), 'admin'::app_role) 
    OR has_role(auth.uid(), 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can modify custom permissions';
  END IF;
  
  -- Check if same school (superadmins can cross schools)
  IF admin_school_id != target_school_id 
     AND NOT has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify users from different schools';
  END IF;
  
  -- Update the flag
  UPDATE public.profiles
  SET custom_permissions_enabled = enabled,
      updated_at = now()
  WHERE user_id = target_user_id;
END;
$$;


ALTER FUNCTION "public"."admin_set_custom_permissions"("target_user_id" "uuid", "enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_permission_request"("request_id" "uuid", "review_notes_param" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_permission_id UUID;
  v_school_id UUID;
  v_permission_details JSONB;
BEGIN
  -- Only admins can approve
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can approve permission requests';
  END IF;

  -- Get request details
  SELECT user_id, permission_id, school_id
  INTO v_user_id, v_permission_id, v_school_id
  FROM public.permission_requests
  WHERE id = request_id AND status = 'pending';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission request not found or already processed';
  END IF;

  -- Get permission details for audit
  SELECT jsonb_build_object(
    'permission_id', p.permission_id,
    'module', p.module,
    'operation', p.operation,
    'resource', p.resource,
    'description', p.description
  ) INTO v_permission_details
  FROM public.permissions p
  WHERE p.permission_id = v_permission_id;

  -- Update request status
  UPDATE public.permission_requests
  SET 
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_notes = review_notes_param,
    updated_at = now()
  WHERE id = request_id;

  -- Grant the permission
  INSERT INTO public.user_permissions (user_id, permission_id, granted_by)
  VALUES (v_user_id, v_permission_id, auth.uid())
  ON CONFLICT (user_id, permission_id) DO NOTHING;

  -- Log to audit trail
  INSERT INTO public.user_permissions_audit (
    user_id,
    permission_id,
    action,
    performed_by,
    school_id,
    permission_details,
    metadata
  ) VALUES (
    v_user_id,
    v_permission_id,
    'granted',
    auth.uid(),
    v_school_id,
    v_permission_details,
    jsonb_build_object(
      'source', 'permission_request',
      'request_id', request_id,
      'review_notes', review_notes_param
    )
  );

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."approve_permission_request"("request_id" "uuid", "review_notes_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "user_role" "public"."app_role") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only allow superadmins to call this function
  IF NOT has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'Only superadmins can assign roles';
  END IF;

  -- Insert or update user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, user_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Ensure profile exists
  INSERT INTO public.profiles (user_id, full_name, email, custom_permissions_enabled)
  SELECT target_user_id, 
         COALESCE(raw_user_meta_data ->> 'full_name', 'User'),
         email,
         false
  FROM auth.users 
  WHERE id = target_user_id
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "user_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_create_terms_for_current_session"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_term_names TEXT[] := ARRAY['Term 1', 'Term 2', 'Term 3'];
  v_session_start_date DATE;
  v_session_end_date DATE;
  v_term_start DATE;
  v_term_end DATE;
  v_term RECORD;
BEGIN
  -- Only act when a session is set as current
  IF NEW.is_current = TRUE THEN
    -- Get session dates
    SELECT start_date, end_date 
    INTO v_session_start_date, v_session_end_date
    FROM public.academic_sessions 
    WHERE id = NEW.id;
    
    -- Check if terms already exist for this session
    SELECT * INTO v_term
    FROM public.terms
    WHERE session_id = NEW.id
    LIMIT 1;
    
    -- If no terms exist, create three terms with 4-month intervals
    IF NOT FOUND THEN
      FOR i IN 1..3 LOOP
        -- Calculate term start date (4 months apart)
        v_term_start := v_session_start_date + INTERVAL '4 months' * (i - 1);
        
        -- Calculate term end date (4 months after start, minus 1 day to avoid overlap)
        v_term_end := v_term_start + INTERVAL '4 months' - INTERVAL '1 day';
        
        -- Ensure the last term ends on the session end date
        IF i = 3 THEN
          v_term_end := v_session_end_date;
        END IF;
        
        -- Insert term
        INSERT INTO public.terms (
          school_id,
          session_id,
          name,
          start_date,
          end_date,
          sequence_order,
          is_current
        ) VALUES (
          NEW.school_id,
          NEW.id,
          v_term_names[i],
          v_term_start,
          v_term_end,
          i,
          i = 1  -- First term is current
        );
      END LOOP;
    ELSE
      -- If terms exist, set the first term as current
      UPDATE public.terms
      SET is_current = TRUE
      WHERE session_id = NEW.id AND sequence_order = 1;
      
      -- Set other terms as not current
      UPDATE public.terms
      SET is_current = FALSE
      WHERE session_id = NEW.id AND sequence_order != 1;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_create_terms_for_current_session"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."auto_create_terms_for_current_session"() IS 'Automatically creates three terms for a session when it is set as current, if terms do not already exist. If terms exist, sets the first term as current.';



CREATE OR REPLACE FUNCTION "public"."auto_transition_enrollments_on_session_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- When a session becomes current, update all active enrollments to use this session
  IF NEW.is_current = TRUE AND (OLD.is_current IS NULL OR OLD.is_current = FALSE) THEN
    UPDATE public.enrollments
    SET 
      session_id = NEW.id,
      updated_at = NOW()
    WHERE 
      school_id = NEW.school_id 
      AND status = 'active'
      AND (session_id != NEW.id OR session_id IS NULL);
      
    RAISE NOTICE 'Auto-transitioned % enrollments to session: %', 
      (SELECT COUNT(*) FROM public.enrollments WHERE school_id = NEW.school_id AND status = 'active'), 
      NEW.name;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_transition_enrollments_on_session_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_update_student_status"("student_ids" "uuid"[], "new_status" "text", "reason" "text", "notes" "text", "effective_date" "date") RETURNS TABLE("success" boolean, "updated_count" integer, "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  -- ✅ Validate new status
  IF new_status NOT IN ('active', 'inactive', 'graduated', 'transferred', 'promoted', 'suspended', 'withdrawn') THEN
    RETURN QUERY SELECT FALSE, 0, 'Invalid status value';
    RETURN;
  END IF;

  -- ✅ Update both 'status' and 'enrollment_status'
  UPDATE students 
  SET 
    enrollment_status = new_status, -- 👈 added this line
    updated_at = NOW()
  WHERE id = ANY(student_ids)
  AND status != new_status; -- Only update if status is different

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- ✅ Insert history records
  INSERT INTO student_status_history (
    student_id,
    school_id,
    old_status,
    new_status,
    reason,
    notes,
    effective_date,
    changed_by
  )
  SELECT 
    s.id,
    s.school_id,
    s.status,
    new_status,
    reason,
    notes,
    effective_date,
    auth.uid()
  FROM students s
  WHERE s.id = ANY(student_ids)
  AND s.status != new_status;

  RETURN QUERY SELECT TRUE, v_updated_count, 
    format('%s students updated to %s status', v_updated_count, new_status);
END;
$$;


ALTER FUNCTION "public"."bulk_update_student_status"("student_ids" "uuid"[], "new_status" "text", "reason" "text", "notes" "text", "effective_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_amount_effective"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Calculate amount_effective based on transaction type
    -- For charges: amount_effective = -amount (debit)
    -- For payments: amount_effective = amount (credit)
    -- For adjustments: depends on direction
    IF NEW.type = 'charge' THEN
        NEW.amount_effective = -NEW.amount;
    ELSIF NEW.type = 'payment' THEN
        NEW.amount_effective = NEW.amount;
    ELSIF NEW.type = 'adjustment' THEN
        IF NEW.adjustment_direction = 'increase' THEN
            NEW.amount_effective = NEW.amount;
        ELSIF NEW.adjustment_direction = 'decrease' THEN
            NEW.amount_effective = -NEW.amount;
        ELSE
            NEW.amount_effective = 0;
        END IF;
    ELSE
        NEW.amount_effective = 0;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_amount_effective"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_effective_amount"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$BEGIN
    -- Calculate amount_effective based on transaction type
    IF NEW.transaction_type = 'credit' THEN
        -- Credit transactions (payments) decrease the balance (negative effective amount)
        NEW.amount_effective = -ABS(NEW.amount);
    ELSIF NEW.transaction_type = 'debit' THEN
        -- Debit transactions (adjustments) increase the balance (positive effective amount)
        NEW.amount_effective = ABS(NEW.amount);
    END IF;
    
    RETURN NEW;
END;$$;


ALTER FUNCTION "public"."calculate_effective_amount"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_loan_payment"("p_principal" numeric, "p_annual_rate" numeric, "p_months" integer) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    monthly_rate DECIMAL;
BEGIN
    -- Convert annual rate to monthly (APR/12)
    monthly_rate := (p_annual_rate/100)/12;
    
    -- PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
    RETURN ROUND(
        p_principal * (monthly_rate * POWER(1 + monthly_rate, p_months)) /
        (POWER(1 + monthly_rate, p_months) - 1),
        2
    );
END;
$$;


ALTER FUNCTION "public"."calculate_loan_payment"("p_principal" numeric, "p_annual_rate" numeric, "p_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_payroll_entry"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Calculate gross pay
  NEW.gross_pay = COALESCE(NEW.basic_salary, 0) + COALESCE(NEW.allowances, 0) + COALESCE(NEW.overtime_pay, 0) + COALESCE(NEW.bonus, 0);
  
  -- Calculate overtime pay if not provided
  IF NEW.overtime_pay IS NULL OR NEW.overtime_pay = 0 THEN
    NEW.overtime_pay = COALESCE(NEW.overtime_hours, 0) * COALESCE(NEW.overtime_rate, 0);
    NEW.gross_pay = NEW.gross_pay + NEW.overtime_pay;
  END IF;
  
  -- Calculate net pay
  NEW.net_pay = NEW.gross_pay - COALESCE(NEW.deductions, 0) - COALESCE(NEW.tax, 0) - COALESCE(NEW.social_security, 0) - COALESCE(NEW.other_deductions, 0);
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_payroll_entry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_user_view_event"("event_id" "uuid", "user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  school_id UUID;
  user_role TEXT;
  user_department_id UUID;
  user_class_id UUID;
BEGIN
  -- Get user's school and role
  SELECT p.school_id, ur.role INTO school_id, user_role
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON p.user_id = ur.user_id
  WHERE p.user_id = can_user_view_event.user_id;
  
  -- Check if event is for this school
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_events 
    WHERE id = can_user_view_event.event_id 
    AND school_id = can_user_view_event.school_id
  ) THEN
    RETURN FALSE;
  END IF;
  
  -- Check if user is admin (can see all events)
  IF user_role IN ('admin', 'superadmin') THEN
    RETURN TRUE;
  END IF;
  
  -- Check specific recipient rules
  RETURN EXISTS (
    SELECT 1 FROM public.event_recipients er
    WHERE er.event_id = can_user_view_event.event_id
    AND (
      -- All staff
      (er.recipient_type = 'all_staff') OR
      -- All teachers
      (er.recipient_type = 'all_teachers' AND user_role = 'teacher') OR
      -- All parents
      (er.recipient_type = 'all_parents' AND user_role = 'parent') OR
      -- Specific department
      (er.recipient_type = 'department' AND er.recipient_id IN (
        SELECT d.department_id 
        FROM public.departments d
        JOIN public.teachers t ON d.department_id = t.department_id
        JOIN public.profiles p ON t.profile_id = p.id
        WHERE p.user_id = can_user_view_event.user_id
      )) OR
      -- Specific class (and parents of students in that class)
      (er.recipient_type = 'class' AND er.recipient_id IN (
        SELECT c.class_id
        FROM public.classes c
        JOIN public.enrollments e ON c.class_id = e.class_id
        WHERE e.student_id IN (
          SELECT s.id 
          FROM public.students s
          JOIN public.profiles p ON s.user_id = p.user_id
          WHERE p.user_id = can_user_view_event.user_id
        )
        UNION
        SELECT c.class_id
        FROM public.classes c
        JOIN public.teacher_assignments ta ON c.class_id = ta.class_id
        JOIN public.teachers t ON ta.teacher_id = t.id
        JOIN public.profiles p ON t.profile_id = p.id
        WHERE p.user_id = can_user_view_event.user_id
      )) OR
      -- Specific staff member
      (er.recipient_type = 'staff_member' AND er.recipient_id = (
        SELECT s.id
        FROM public.staff s
        JOIN public.profiles p ON s.user_id = p.user_id
        WHERE p.user_id = can_user_view_event.user_id
      ))
    )
  );
END;
$$;


ALTER FUNCTION "public"."can_user_view_event"("event_id" "uuid", "user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_staff_profiles"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.staff s1
    JOIN public.staff s2 ON s1.school_id = s2.school_id
    WHERE s1.user_id = auth.uid() 
    AND s2.user_id = _user_id
  ) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role);
$$;


ALTER FUNCTION "public"."can_view_staff_profiles"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_notification_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id, school_id)
  SELECT NEW.user_id, NEW.school_id
  FROM public.profiles
  WHERE user_id = NEW.user_id
  ON CONFLICT (user_id, school_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_default_notification_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_user_with_profile_and_role"("p_email" "text", "p_password" "text", "p_full_name" "text", "p_role" "text", "p_school_id" "uuid", "p_employee_id" "text" DEFAULT NULL::"text", "p_title" "text" DEFAULT NULL::"text", "p_first_name" "text" DEFAULT NULL::"text", "p_middle_name" "text" DEFAULT NULL::"text", "p_last_name" "text" DEFAULT NULL::"text", "p_sex" "text" DEFAULT NULL::"text", "p_date_of_birth" "date" DEFAULT NULL::"date", "p_marital_status" "text" DEFAULT NULL::"text", "p_number_of_children" integer DEFAULT NULL::integer, "p_national_id_type" "text" DEFAULT NULL::"text", "p_national_id_number" "text" DEFAULT NULL::"text", "p_residential_address" "text" DEFAULT NULL::"text", "p_mobile_number" "text" DEFAULT NULL::"text", "p_secondary_mobile" "text" DEFAULT NULL::"text", "p_next_of_kin_name" "text" DEFAULT NULL::"text", "p_next_of_kin_relationship" "text" DEFAULT NULL::"text", "p_next_of_kin_phone" "text" DEFAULT NULL::"text", "p_emergency_contact_name" "text" DEFAULT NULL::"text", "p_emergency_contact_phone" "text" DEFAULT NULL::"text", "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_position_id" "uuid" DEFAULT NULL::"uuid", "p_hire_date" "date" DEFAULT NULL::"date", "p_job_description" "text" DEFAULT NULL::"text", "p_salary" numeric DEFAULT NULL::numeric, "p_phone" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_emergency_contact" "text" DEFAULT NULL::"text", "p_contract_type" "text" DEFAULT NULL::"text", "p_employment_type" "text" DEFAULT NULL::"text", "p_job_title" "text" DEFAULT NULL::"text", "p_staff_category" "text" DEFAULT NULL::"text", "p_qualification" "text" DEFAULT NULL::"text", "p_basic_salary_gross" numeric DEFAULT NULL::numeric, "p_payment_mode" "text" DEFAULT NULL::"text", "p_bank_name" "text" DEFAULT NULL::"text", "p_bank_account_number" "text" DEFAULT NULL::"text", "p_bank_branch" "text" DEFAULT NULL::"text", "p_ssnit_contributor" boolean DEFAULT NULL::boolean, "p_ssnit_number" "text" DEFAULT NULL::"text", "p_tin_number" "text" DEFAULT NULL::"text", "p_license_number" "text" DEFAULT NULL::"text", "p_license_expiry_date" "date" DEFAULT NULL::"date", "p_license_type" "text" DEFAULT NULL::"text", "p_teaching_license_number" "text" DEFAULT NULL::"text") RETURNS TABLE("created_user_id" "uuid", "success" boolean, "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id uuid;
  v_staff_id uuid;
  v_staff_employee_id text;
  v_normalized_email text;
  
  -- Cleaned variables
  v_school_id uuid;
  v_department_id uuid;
BEGIN
  -- Normalize email
  v_normalized_email := LOWER(TRIM(p_email));

  -- Acquire advisory lock keyed by email hash to reduce race conditions
  PERFORM pg_advisory_xact_lock(hashtext(v_normalized_email)::bigint);

  -- Clean input parameters - convert empty strings to NULL
  v_school_id := NULLIF(TRIM(p_school_id::text), '')::uuid;
  v_department_id := NULLIF(TRIM(p_department_id::text), '')::uuid;

  -- ============================================
  -- CONFLICT CHECKS - Must be done FIRST
  -- ============================================

  -- Check 1: Email in auth.users
  IF EXISTS (SELECT 1 FROM auth.users WHERE LOWER(TRIM(email)) = v_normalized_email) THEN
    RAISE EXCEPTION 'EMAIL_EXISTS:A user with email "%" already exists in auth.users', p_email;
  END IF;

  -- Check 2: Email in profiles
  IF EXISTS (SELECT 1 FROM profiles WHERE LOWER(TRIM(email)) = v_normalized_email) THEN
    RAISE EXCEPTION 'EMAIL_EXISTS:A user with email "%" already exists in profiles', p_email;
  END IF;

  -- Check 3: Employee ID (if staff role and employee_id provided)
  IF p_role IN ('teacher','driver','librarian','accountant','nurse','security_guard','janitor','other_staff')
     AND NULLIF(TRIM(p_employee_id), '') IS NOT NULL
     AND v_school_id IS NOT NULL
  THEN
    IF EXISTS (
      SELECT 1 FROM staff
      WHERE employee_id = NULLIF(TRIM(p_employee_id), '')
        AND school_id = v_school_id
    ) THEN
      RAISE EXCEPTION 'EMPLOYEE_ID_EXISTS:Employee ID "%" already exists for this school', p_employee_id;
    END IF;
  END IF;

  -- Check 4: License number (if driver)
  IF p_role = 'driver'
     AND NULLIF(TRIM(p_license_number), '') IS NOT NULL
     AND v_school_id IS NOT NULL
  THEN
    IF EXISTS (
      SELECT 1 FROM drivers
      WHERE license_number = NULLIF(TRIM(p_license_number), '')
        AND school_id = v_school_id
    ) THEN
      RAISE EXCEPTION 'LICENSE_EXISTS:License number "%" already exists for this school', p_license_number;
    END IF;
  END IF;

  -- Check 5: National ID (if provided)
  IF NULLIF(TRIM(p_national_id_number), '') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM profiles
      WHERE national_id_number = NULLIF(TRIM(p_national_id_number), '')
        AND school_id = v_school_id
    ) THEN
      RAISE EXCEPTION 'NATIONAL_ID_EXISTS:National ID "%" already exists for this school', p_national_id_number;
    END IF;
  END IF;

  -- ============================================
  -- UUID GENERATION
  -- ============================================
  v_user_id := gen_random_uuid();

  -- Check for UUID collisions (very rare but possible)
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'UUID_COLLISION:Generated UUID already exists in auth.users (try again)';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'UUID_COLLISION:Generated UUID already exists in profiles (try again)';
  END IF;

  -- ============================================
  -- CREATE AUTH USER (FIRST)
  -- ============================================
  BEGIN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at,
      email_change_token_new, email_change, email_change_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
      phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
      email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token,
      reauthentication_sent_at, is_sso_user, deleted_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_normalized_email,
      crypt(p_password, gen_salt('bf')),
      now(),
      now(),
      '',
      now(),
      '',
      now(),
      '',
      '',
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      json_build_object('full_name', p_full_name),
      false,
      now(),
      now(),
      null, null, '', '', now(), '', 0, null, '', now(), false, null
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'AUTH_USER_EXISTS:Failed to create auth user - duplicate constraint violation';
    WHEN OTHERS THEN
      RAISE EXCEPTION 'AUTH_USER_ERROR:Failed to create auth user - %', SQLERRM;
  END;

  -- ============================================
  -- CREATE PROFILE (SECOND)
  -- ============================================
  BEGIN
    INSERT INTO profiles (
      user_id, full_name, email, school_id, custom_permissions_enabled, temp_password,
      title, first_name, middle_name, last_name, sex, date_of_birth, marital_status,
      number_of_children, national_id_type, national_id_number, residential_address,
      mobile_number, secondary_mobile, next_of_kin_name, next_of_kin_relationship,
      next_of_kin_phone, emergency_contact_name, emergency_contact_phone
    ) VALUES (
      v_user_id, p_full_name, v_normalized_email, v_school_id, false, p_password,
      NULLIF(TRIM(p_title), ''), NULLIF(TRIM(p_first_name), ''), NULLIF(TRIM(p_middle_name), ''),
      NULLIF(TRIM(p_last_name), ''), NULLIF(TRIM(p_sex), ''), p_date_of_birth,
      NULLIF(TRIM(p_marital_status), ''), p_number_of_children, NULLIF(TRIM(p_national_id_type), ''),
      NULLIF(TRIM(p_national_id_number), ''), NULLIF(TRIM(p_residential_address), ''),
      NULLIF(TRIM(p_mobile_number), ''), NULLIF(TRIM(p_secondary_mobile), ''),
      NULLIF(TRIM(p_next_of_kin_name), ''), NULLIF(TRIM(p_next_of_kin_relationship), ''),
      NULLIF(TRIM(p_next_of_kin_phone), ''), NULLIF(TRIM(p_emergency_contact_name), ''),
      NULLIF(TRIM(p_emergency_contact_phone), '')
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'PROFILE_EXISTS:Failed to create profile - duplicate user_id or email';
    WHEN OTHERS THEN
      RAISE EXCEPTION 'PROFILE_ERROR:Failed to create profile - %', SQLERRM;
  END;

  -- ============================================
  -- ASSIGN ROLE (THIRD)
  -- ============================================
  BEGIN
    INSERT INTO user_roles (user_id, role)
    VALUES (v_user_id, p_role::app_role);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'ROLE_ERROR:Failed to assign role - %', SQLERRM;
  END;

  -- ============================================
  -- HANDLE ROLE-SPECIFIC ENTRIES (staff)
  -- ============================================
  IF p_role IN ('teacher','driver','librarian','accountant','nurse','security_guard','janitor','other_staff') THEN
    -- SIMPLIFIED: Remove all manual duplicate checks, rely on database constraints
    
    BEGIN
      INSERT INTO staff (
        user_id, employee_id, school_id, job_description, department_id, position_id, hire_date,
        salary, phone, address, emergency_contact, contract_type, status, job_title,
        staff_category, qualification, basic_salary_gross, payment_mode, bank_name,
        bank_account_number, bank_branch, ssnit_contributor, ssnit_number, tin_number, role_specific_data
      ) VALUES (
        v_user_id,
        NULLIF(TRIM(p_employee_id), ''),
        v_school_id,
        COALESCE(NULLIF(TRIM(p_job_description), ''), INITCAP(REPLACE(p_role, '_', ' '))),
        v_department_id,
        p_position_id,
        p_hire_date,
        p_salary,
        COALESCE(NULLIF(TRIM(p_phone), ''), NULLIF(TRIM(p_mobile_number), '')),
        COALESCE(NULLIF(TRIM(p_address), ''), NULLIF(TRIM(p_residential_address), '')),
        COALESCE(NULLIF(TRIM(p_emergency_contact), ''), NULLIF(TRIM(p_emergency_contact_name), '')),
        NULLIF(TRIM(p_contract_type), ''),
        'active',
        NULLIF(TRIM(p_job_title), ''),
        NULLIF(TRIM(p_staff_category), ''),
        NULLIF(TRIM(p_qualification), ''),
        p_basic_salary_gross,
        NULLIF(TRIM(p_payment_mode), ''),
        NULLIF(TRIM(p_bank_name), ''),
        NULLIF(TRIM(p_bank_account_number), ''),
        NULLIF(TRIM(p_bank_branch), ''),
        p_ssnit_contributor,
        NULLIF(TRIM(p_ssnit_number), ''),
        NULLIF(TRIM(p_tin_number), ''),
        CASE WHEN p_role = 'teacher' AND NULLIF(TRIM(p_teaching_license_number), '') IS NOT NULL
             THEN json_build_object('teaching_license_number', NULLIF(TRIM(p_teaching_license_number), ''))
             ELSE NULL
        END
      )
      RETURNING id, employee_id INTO v_staff_id, v_staff_employee_id;
      
      RAISE NOTICE 'Staff record created successfully: user_id=%, staff_id=%, employee_id=%', 
        v_user_id, v_staff_id, v_staff_employee_id;
        
    EXCEPTION
      WHEN unique_violation THEN
        -- Let the database tell us exactly what constraint was violated
        RAISE EXCEPTION 'STAFF_EXISTS:Failed to create staff record - duplicate entry';
      WHEN OTHERS THEN
        RAISE EXCEPTION 'STAFF_ERROR:Failed to create staff record - %', SQLERRM;
    END;

    -- teacher/driver role subtables...
    IF p_role = 'teacher' THEN
      BEGIN
        INSERT INTO teachers (user_id, employee_id, school_id, department_id, hire_date, qualification)
        VALUES (v_user_id, v_staff_employee_id, v_school_id, v_department_id, p_hire_date, NULLIF(TRIM(p_qualification), ''));
        
        RAISE NOTICE 'Teacher record created successfully for user_id: %', v_user_id;
        
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'TEACHER_EXISTS:Failed to create teacher record - duplicate user_id or employee_id';
        WHEN OTHERS THEN
          RAISE EXCEPTION 'TEACHER_ERROR:Failed to create teacher record - %', SQLERRM;
      END;
    ELSIF p_role = 'driver' THEN
      BEGIN
        INSERT INTO drivers (user_id, school_id, staff_id, license_number, license_expiry_date, license_type, residential_address, hire_date)
        VALUES (v_user_id, v_school_id, v_staff_id, NULLIF(TRIM(p_license_number), ''), p_license_expiry_date, NULLIF(TRIM(p_license_type), ''), COALESCE(NULLIF(TRIM(p_address), ''), NULLIF(TRIM(p_residential_address), '')), p_hire_date);
        
        RAISE NOTICE 'Driver record created successfully for user_id: %', v_user_id;
        
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'DRIVER_EXISTS:Failed to create driver record - duplicate user_id, license_number or school combination';
        WHEN OTHERS THEN
          RAISE EXCEPTION 'DRIVER_ERROR:Failed to create driver record - %', SQLERRM;
      END;
    END IF;
  ELSIF p_role = 'parent' THEN
    -- Parent handling
    BEGIN
      INSERT INTO parents (user_id) VALUES (v_user_id);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'PARENT_EXISTS:Failed to create parent record - duplicate user_id';
      WHEN OTHERS THEN
        RAISE EXCEPTION 'PARENT_ERROR:Failed to create parent record - %', SQLERRM;
    END;

    -- Auto-link parent to students via emergency contacts
    INSERT INTO public.parent_student_links (student_id, parent_user_id, relationship, is_primary, school_id)
    SELECT ec.student_id, v_user_id, COALESCE(NULLIF(TRIM(ec.relationship), ''), 'guardian'), COALESCE(ec.is_primary_contact, false), ec.school_id
    FROM public.emergency_contacts AS ec
    WHERE LOWER(TRIM(ec.email)) = v_normalized_email
    ON CONFLICT (student_id, parent_user_id) DO NOTHING;
  END IF;

  -- Return success with message
  RETURN QUERY
  SELECT v_user_id AS created_user_id, true AS success, 'User created successfully'::text AS message;

EXCEPTION
  WHEN others THEN
    RAISE EXCEPTION '%', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."create_user_with_profile_and_role"("p_email" "text", "p_password" "text", "p_full_name" "text", "p_role" "text", "p_school_id" "uuid", "p_employee_id" "text", "p_title" "text", "p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_sex" "text", "p_date_of_birth" "date", "p_marital_status" "text", "p_number_of_children" integer, "p_national_id_type" "text", "p_national_id_number" "text", "p_residential_address" "text", "p_mobile_number" "text", "p_secondary_mobile" "text", "p_next_of_kin_name" "text", "p_next_of_kin_relationship" "text", "p_next_of_kin_phone" "text", "p_emergency_contact_name" "text", "p_emergency_contact_phone" "text", "p_department_id" "uuid", "p_position_id" "uuid", "p_hire_date" "date", "p_job_description" "text", "p_salary" numeric, "p_phone" "text", "p_address" "text", "p_emergency_contact" "text", "p_contract_type" "text", "p_employment_type" "text", "p_job_title" "text", "p_staff_category" "text", "p_qualification" "text", "p_basic_salary_gross" numeric, "p_payment_mode" "text", "p_bank_name" "text", "p_bank_account_number" "text", "p_bank_branch" "text", "p_ssnit_contributor" boolean, "p_ssnit_number" "text", "p_tin_number" "text", "p_license_number" "text", "p_license_expiry_date" "date", "p_license_type" "text", "p_teaching_license_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deny_permission_request"("request_id" "uuid", "review_notes_param" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only admins can deny
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can deny permission requests';
  END IF;

  -- Update request status
  UPDATE public.permission_requests
  SET 
    status = 'denied',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_notes = review_notes_param,
    updated_at = now()
  WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permission request not found or already processed';
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."deny_permission_request"("request_id" "uuid", "review_notes_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_current_session"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.is_current = true THEN
    -- Set all other sessions for this school to not current
    UPDATE public.academic_sessions 
    SET is_current = false 
    WHERE school_id = NEW.school_id AND id != NEW.id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_current_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_current_term"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.is_current = true THEN
    -- Set all other terms for this school to not current
    UPDATE public.terms 
    SET is_current = false 
    WHERE school_id = NEW.school_id AND id != NEW.id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_current_term"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_employee_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
    school_prefix TEXT;
    next_number INTEGER;
    new_employee_id TEXT;
    retry_count INTEGER := 0;
    max_retries INTEGER := 5;
BEGIN
    -- Only generate if employee_id is empty or null
    IF NEW.employee_id IS NULL OR NEW.employee_id = '' THEN
        -- Use advisory lock to prevent concurrent ID generation
        PERFORM pg_advisory_lock(hashtext('employee_id_generation_' || COALESCE(NEW.school_id::text, 'default')));
        
        BEGIN
            LOOP
                -- Get the prefix from school settings or use default
                SELECT COALESCE((settings->>'employee_id_prefix'), 'EMP')
                INTO school_prefix
                FROM schools 
                WHERE school_id = NEW.school_id;
                
                -- If no school found or no prefix, use default
                IF school_prefix IS NULL THEN
                    school_prefix := 'EMP';
                END IF;
                
                -- Find the next available number for this school and prefix
                -- Use a more robust query that handles edge cases
                WITH numbered_employees AS (
                    SELECT employee_id,
                           CASE 
                               WHEN employee_id ~ ('^' || school_prefix || '[0-9]+$') 
                               THEN CAST(SUBSTRING(employee_id FROM LENGTH(school_prefix) + 1) AS INTEGER)
                               ELSE 0 
                           END as emp_number
                    FROM staff 
                    WHERE school_id = NEW.school_id 
                      AND employee_id IS NOT NULL 
                      AND employee_id != ''
                )
                SELECT COALESCE(MAX(emp_number), 0) + 1
                INTO next_number
                FROM numbered_employees;
                
                -- Format the new employee ID with leading zeros (4 digits)
                new_employee_id := school_prefix || LPAD(next_number::TEXT, 4, '0');
                
                -- Check if this ID already exists (double-check)
                IF NOT EXISTS (
                    SELECT 1 FROM staff 
                    WHERE employee_id = new_employee_id 
                      AND school_id = NEW.school_id
                ) THEN
                    -- Set the generated ID and exit loop
                    NEW.employee_id := new_employee_id;
                    EXIT;
                END IF;
                
                -- If we get here, there was a collision, retry
                retry_count := retry_count + 1;
                IF retry_count >= max_retries THEN
                    RAISE EXCEPTION 'Failed to generate unique employee ID after % attempts', max_retries;
                END IF;
                
                -- Small delay before retry
                PERFORM pg_sleep(0.01);
            END LOOP;
            
        EXCEPTION WHEN OTHERS THEN
            -- Always release the lock in case of error
            PERFORM pg_advisory_unlock(hashtext('employee_id_generation_' || COALESCE(NEW.school_id::text, 'default')));
            RAISE;
        END;
        
        -- Release the advisory lock
        PERFORM pg_advisory_unlock(hashtext('employee_id_generation_' || COALESCE(NEW.school_id::text, 'default')));
    END IF;
    
    RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."generate_employee_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_fee_account_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
    school_code TEXT;
    next_number INTEGER;
    new_account_number TEXT;
BEGIN
    -- Only generate if account_number is empty or null
    IF NEW.account_number IS NULL OR NEW.account_number = '' THEN
        -- Get the school code
        SELECT COALESCE(code, 'SCH')
        INTO school_code
        FROM schools 
        WHERE school_id = NEW.school_id;
        
        -- If no school found, use default
        IF school_code IS NULL THEN
            school_code := 'SCH';
        END IF;
        
        -- Find the next available number for this school
        SELECT COALESCE(MAX(
            CASE 
                WHEN account_number ~ ('^' || school_code || '[0-9]+$') 
                THEN CAST(SUBSTRING(account_number FROM LENGTH(school_code) + 1) AS INTEGER)
                ELSE 0 
            END
        ), 0) + 1
        INTO next_number
        FROM fee_accounts 
        WHERE school_id = NEW.school_id;
        
        -- Format the new account number with leading zeros (6 digits)
        new_account_number := school_code || LPAD(next_number::TEXT, 6, '0');
        
        -- Set the generated account number
        NEW.account_number := new_account_number;
    END IF;
    
    RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."generate_fee_account_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_student_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
    school_prefix TEXT;
    next_number INTEGER;
    new_student_id TEXT;
BEGIN
    -- Only generate if student_id is empty or null
    IF NEW.student_id IS NULL OR NEW.student_id = '' THEN
        -- Get the prefix from school settings
        SELECT COALESCE((settings->>'student_id_prefix'), 'STU')
        INTO school_prefix
        FROM schools 
        WHERE school_id = NEW.school_id;
        
        -- If no school found or no prefix, use default
        IF school_prefix IS NULL THEN
            school_prefix := 'STU';
        END IF;
        
        -- Find the next available number for this school and prefix
        SELECT COALESCE(MAX(
            CASE 
                WHEN student_id ~ ('^' || school_prefix || '[0-9]+$') 
                THEN CAST(SUBSTRING(student_id FROM LENGTH(school_prefix) + 1) AS INTEGER)
                ELSE 0 
            END
        ), 0) + 1
        INTO next_number
        FROM students 
        WHERE school_id = NEW.school_id;
        
        -- Format the new student ID with leading zeros (3 digits)
        new_student_id := school_prefix || LPAD(next_number::TEXT, 3, '0');
        
        -- Set the generated ID
        NEW.student_id := new_student_id;
    END IF;
    
    RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."generate_student_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_attendance_summary"("school_id" "uuid", "days_back" integer DEFAULT 30) RETURNS TABLE("date" "date", "class_name" "text", "present_count" integer, "total_students" integer, "attendance_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.date,
        c.name AS class_name,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END)::INTEGER AS present_count,
        COUNT(a.student_id)::INTEGER AS total_students,
        CASE 
            WHEN COUNT(a.student_id) > 0 
            THEN ROUND((COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(a.student_id))::NUMERIC, 1)
            ELSE 0::NUMERIC
        END AS attendance_rate
    FROM attendance a
    JOIN classes c ON a.class_id = c.class_id
    WHERE a.school_id = get_attendance_summary.school_id
        AND a.date >= CURRENT_DATE - (days_back || ' days')::INTERVAL
        AND a.student_id IS NOT NULL
    GROUP BY a.date, c.name
    ORDER BY a.date DESC, c.name;
END;
$$;


ALTER FUNCTION "public"."get_attendance_summary"("school_id" "uuid", "days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_attendance_summary_by_class"("class_ids" "uuid"[], "school_id" "uuid", "days_back" integer DEFAULT 30) RETURNS TABLE("date" "date", "class_name" "text", "present_count" integer, "total_students" integer, "attendance_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.date,
        c.name AS class_name,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END)::INTEGER AS present_count,
        COUNT(a.student_id)::INTEGER AS total_students,
        CASE 
            WHEN COUNT(a.student_id) > 0 
            THEN ROUND((COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(a.student_id))::NUMERIC, 1)
            ELSE 0::NUMERIC
        END AS attendance_rate
    FROM attendance a
    JOIN classes c ON a.class_id = c.class_id
    WHERE a.school_id = get_attendance_summary_by_class.school_id
        AND a.class_id = ANY(class_ids)
        AND a.date >= CURRENT_DATE - (days_back || ' days')::INTERVAL
        AND a.student_id IS NOT NULL
    GROUP BY a.date, c.name
    ORDER BY a.date DESC, c.name;
END;
$$;


ALTER FUNCTION "public"."get_attendance_summary_by_class"("class_ids" "uuid"[], "school_id" "uuid", "days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_class_relationships"("school_id" "uuid") RETURNS TABLE("class_id" "uuid", "name" "text", "sub_class" "text", "parent_class_id" "uuid", "parent_class_name" "text", "department_id" "uuid", "department_name" "text", "is_subclass" boolean, "class_type" "text", "student_count" bigint, "subject_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.class_id,
        c.name,
        c.sub_class,
        c.parent_class_id,
        pc.name as parent_class_name,
        c.department_id,
        d.name as department_name,
        c.is_subclass,
        c.class_type,
        COALESCE(student_counts.student_count, 0) as student_count,
        COALESCE(subject_counts.subject_count, 0) as subject_count
    FROM public.classes c
    LEFT JOIN public.classes pc ON c.parent_class_id = pc.class_id
    LEFT JOIN public.departments d ON c.department_id = d.department_id
    LEFT JOIN (
        SELECT 
            class_id,
            COUNT(*) as student_count
        FROM public.enrollments
        WHERE status = 'active'
        GROUP BY class_id
    ) student_counts ON c.class_id = student_counts.class_id
    LEFT JOIN (
        SELECT 
            class_id,
            COUNT(*) as subject_count
        FROM public.class_subjects
        GROUP BY class_id
    ) subject_counts ON c.class_id = subject_counts.class_id
    WHERE c.school_id = get_class_relationships.school_id
    ORDER BY c.name, c.sub_class;
END;
$$;


ALTER FUNCTION "public"."get_class_relationships"("school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_session"("_school_id" "uuid") RETURNS TABLE("session_id" "uuid", "session_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id, name
  FROM public.academic_sessions
  WHERE school_id = _school_id
    AND is_current = true
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_current_session"("_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_term"("_school_id" "uuid") RETURNS TABLE("term_id" "uuid", "term_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id, name
  FROM public.terms
  WHERE school_id = _school_id
    AND is_current = true
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_current_term"("_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_departments_with_counts"("school_id_param" "uuid") RETURNS TABLE("department_id" "uuid", "name" "text", "description" "text", "head_of_department" "uuid", "budget" numeric, "school_id" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "class_count" bigint, "teacher_count" bigint, "subject_count" bigint, "head_of_department_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.department_id,
        d.name,
        d.description,
        d.head_of_department,
        d.budget,
        d.school_id,
        d.created_at,
        d.updated_at,
        COALESCE(class_counts.count, 0)::BIGINT as class_count,
        COALESCE(teacher_counts.count, 0)::BIGINT as teacher_count,
        COALESCE(subject_counts.count, 0)::BIGINT as subject_count,
        p.full_name as head_of_department_name
    FROM public.departments d
    LEFT JOIN (
        SELECT 
            department_id,
            COUNT(*) as count
        FROM public.classes
        WHERE class_type = 'umbrella'
        GROUP BY department_id
    ) class_counts ON d.department_id = class_counts.department_id
    LEFT JOIN (
        SELECT 
            department_id,
            COUNT(*) as count
        FROM public.teachers
        GROUP BY department_id
    ) teacher_counts ON d.department_id = teacher_counts.department_id
    LEFT JOIN (
        SELECT 
            sd.department_id,
            COUNT(DISTINCT sd.subject_id) as count
        FROM public.subjects_departments sd
        GROUP BY sd.department_id
    ) subject_counts ON d.department_id = subject_counts.department_id
    LEFT JOIN public.profiles p ON d.head_of_department = p.user_id
    WHERE d.school_id = school_id_param
    ORDER BY d.name;
END;
$$;


ALTER FUNCTION "public"."get_departments_with_counts"("school_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_session"("_school_id" "uuid", "_current_session_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "start_date" "date", "end_date" "date", "sequence_order" integer, "is_current" boolean)
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
  select s.id,
         s.name,
         s.start_date,
         s.end_date,
         s.sequence_order,
         s.is_current
  from academic_sessions s
  where s.school_id = _school_id
    and s.sequence_order > coalesce(
      (select curr.sequence_order
       from academic_sessions curr
       where curr.id = _current_session_id
         and curr.school_id = _school_id),
      0
    )
  order by s.sequence_order asc
  limit 1;
end;
$$;


ALTER FUNCTION "public"."get_next_session"("_school_id" "uuid", "_current_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pending_permission_requests_count"("school_id_param" "uuid") RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.permission_requests
  WHERE school_id = school_id_param
    AND status = 'pending';
$$;


ALTER FUNCTION "public"."get_pending_permission_requests_count"("school_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_permission_audit_stats"("p_user_id" "uuid") RETURNS TABLE("total_changes" bigint, "grants_count" bigint, "revocations_count" bigint, "last_change_at" timestamp with time zone, "last_changed_by" "text", "unique_permissions_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_changes,
    COUNT(*) FILTER (WHERE action IN ('granted', 'bulk_granted', 'template_applied')) as grants_count,
    COUNT(*) FILTER (WHERE action IN ('revoked', 'bulk_revoked')) as revocations_count,
    MAX(performed_at) as last_change_at,
    (
      SELECT p.full_name 
      FROM public.user_permissions_audit a2
      LEFT JOIN public.profiles p ON a2.performed_by = p.user_id
      WHERE a2.user_id = p_user_id
      ORDER BY a2.performed_at DESC
      LIMIT 1
    ) as last_changed_by,
    COUNT(DISTINCT permission_id) as unique_permissions_count
  FROM public.user_permissions_audit
  WHERE user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."get_permission_audit_stats"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_promotion_preview"("student_ids" "uuid"[], "target_class_id" "uuid") RETURNS TABLE("student_id" "uuid", "student_name" "text", "current_class" "text", "target_class" "text", "is_eligible" boolean, "eligibility_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.first_name || ' ' || s.last_name,
    COALESCE(e.class_level || 
      CASE WHEN e.section IS NOT NULL 
        THEN ' - ' || e.section 
        ELSE '' 
      END, 'Not Enrolled'),
    c.name || 
      CASE WHEN c.sub_class IS NOT NULL 
        THEN ' - ' || c.sub_class 
        ELSE '' 
      END,
    CASE 
      WHEN s.status != 'active' THEN FALSE
      ELSE TRUE
    END,
    CASE 
      WHEN s.status != 'active' THEN 'Student is not active'
      ELSE 'Eligible for promotion'
    END
  FROM students s
  LEFT JOIN LATERAL (
    SELECT class_level, section
    FROM enrollments 
    WHERE student_id = s.id 
      AND status = 'active'
    ORDER BY created_at DESC 
    LIMIT 1
  ) e ON TRUE
  CROSS JOIN classes c
  WHERE s.id = ANY(student_ids)
    AND c.class_id = target_class_id;
END;
$$;


ALTER FUNCTION "public"."get_promotion_preview"("student_ids" "uuid"[], "target_class_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_promotion_preview"("student_ids" "uuid"[], "target_class_id" "uuid") IS 'Preview promotion details before executing';



CREATE OR REPLACE FUNCTION "public"."get_public_staff_roles"("staff_user_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "role" "public"."app_role")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT ur.user_id, ur.role
  FROM public.user_roles ur
  WHERE ur.user_id = ANY(staff_user_ids)
$$;


ALTER FUNCTION "public"."get_public_staff_roles"("staff_user_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_billing_summary"("school_id_param" "uuid", "class_id_param" "uuid" DEFAULT NULL::"uuid", "term_id_param" "uuid" DEFAULT NULL::"uuid", "session_id_param" "uuid" DEFAULT NULL::"uuid", "date_from_param" "date" DEFAULT NULL::"date", "date_to_param" "date" DEFAULT NULL::"date") RETURNS TABLE("id" "uuid", "student_name" "text", "student_id" "text", "class_name" "text", "total_billed" numeric, "total_paid" numeric, "outstanding_balance" numeric, "last_payment_date" "date")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    (s.first_name || ' ' || s.last_name)::text as student_name,
    s.student_id::text,
    c.name::text as class_name,
    COALESCE(SUM(b.total_amount), 0)::numeric as total_billed,
    COALESCE(SUM(p.amount), 0)::numeric as total_paid,
    (COALESCE(SUM(b.total_amount), 0) - COALESCE(SUM(p.amount), 0))::numeric as outstanding_balance,
    MAX(p.payment_date)::date as last_payment_date
  FROM public.students s
  LEFT JOIN public.enrollments e ON s.id = e.student_id AND e.status = 'active'
  LEFT JOIN public.classes c ON e.class_id = c.class_id
  LEFT JOIN public.bills b ON s.id = b.student_id 
    AND b.school_id = school_id_param 
    AND b.status = 'published'
    AND (term_id_param IS NULL OR b.term_id = term_id_param)
    AND (session_id_param IS NULL OR b.session_id = session_id_param)
    AND (date_from_param IS NULL OR b.due_date >= date_from_param)
    AND (date_to_param IS NULL OR b.due_date <= date_to_param)
  LEFT JOIN public.payments p ON s.id = p.student_id 
    AND p.school_id = school_id_param 
    AND p.status = 'confirmed'
    AND (date_from_param IS NULL OR p.payment_date >= date_from_param)
    AND (date_to_param IS NULL OR p.payment_date <= date_to_param)
  WHERE s.school_id = school_id_param
    AND (class_id_param IS NULL OR c.class_id = class_id_param)
  GROUP BY s.id, s.first_name, s.last_name, s.student_id, c.name
  ORDER BY s.first_name, s.last_name;
END;
$$;


ALTER FUNCTION "public"."get_student_billing_summary"("school_id_param" "uuid", "class_id_param" "uuid", "term_id_param" "uuid", "session_id_param" "uuid", "date_from_param" "date", "date_to_param" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_custom_permissions_enabled"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(custom_permissions_enabled, false)
  FROM public.profiles 
  WHERE user_id = _user_id
$$;


ALTER FUNCTION "public"."get_user_custom_permissions_enabled"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_events"("user_id" "uuid", "start_date" "date", "end_date" "date") RETURNS TABLE("id" "uuid", "title" "text", "description" "text", "start_time" timestamp with time zone, "end_time" timestamp with time zone, "event_type" "text", "created_by" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "is_all_day" boolean, "location" "text", "color" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.title,
    ce.description,
    ce.start_time,
    ce.end_time,
    ce.event_type,
    ce.created_by,
    ce.created_at,
    ce.updated_at,
    ce.is_all_day,
    ce.location,
    ce.color
  FROM public.calendar_events ce
  WHERE ce.school_id = (
    SELECT school_id FROM public.profiles WHERE user_id = get_user_events.user_id
  )
  AND ce.start_time >= get_user_events.start_date
  AND ce.end_time <= get_user_events.end_date
  AND public.can_user_view_event(ce.id, get_user_events.user_id)
  
  UNION ALL
  
  SELECT 
    ue.id,
    ue.title,
    ue.description,
    ue.start_time,
    ue.end_time,
    'personal'::TEXT as event_type,
    ue.user_id as created_by,
    ue.created_at,
    ue.updated_at,
    ue.is_all_day,
    ue.location,
    ue.color
  FROM public.user_events ue
  WHERE ue.user_id = get_user_events.user_id
  AND ue.start_time >= get_user_events.start_date
  AND ue.end_time <= get_user_events.end_date
  ORDER BY start_time;
END;
$$;


ALTER FUNCTION "public"."get_user_events"("user_id" "uuid", "start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permission_audit"("p_user_id" "uuid", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "user_id" "uuid", "permission_id" "uuid", "action" "text", "performed_by" "uuid", "performed_at" timestamp with time zone, "school_id" "uuid", "metadata" "jsonb", "permission_details" "jsonb", "performer_name" "text", "performer_email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.user_id,
    a.permission_id,
    a.action,
    a.performed_by,
    a.performed_at,
    a.school_id,
    a.metadata,
    a.permission_details,
    p.full_name as performer_name,
    p.email as performer_email
  FROM public.user_permissions_audit a
  LEFT JOIN public.profiles p ON a.performed_by = p.user_id
  WHERE a.user_id = p_user_id
  ORDER BY a.performed_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."get_user_permission_audit"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions"("user_id" "uuid") RETURNS TABLE("permission_id" "uuid", "module" "text", "operation" "public"."crud_operation", "resource" "text", "description" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  SELECT 
    up.permission_id,
    p.module,
    p.operation,
    p.resource,
    p.description
  FROM user_permissions up
  JOIN permissions p ON up.permission_id = p.permission_id
  WHERE up.user_id = $1
    AND (up.expires_at IS NULL OR up.expires_at > now())
$_$;


ALTER FUNCTION "public"."get_user_permissions"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_schools"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT school_id
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND school_id IS NOT NULL
$$;


ALTER FUNCTION "public"."get_user_schools"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vehicle_assistant_assignments"("school_id_param" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("assignment_id" "uuid", "assigned_at" timestamp with time zone, "assignment_status" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "vehicle_id" "uuid", "registration_number" "text", "bus_name" "text", "model" "text", "capacity" integer, "operational_status" "text", "assistant_id" "uuid", "staff_id" "uuid", "employee_id" "text", "user_id" "uuid", "job_title" "text", "staff_status" "text", "assistant_name" "text", "first_name" "text", "middle_name" "text", "last_name" "text", "assistant_email" "text", "assistant_mobile" "text", "assistant_address" "text", "school_id" "uuid", "school_name" "text", "assigned_by" "uuid", "assigned_by_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        -- Assignment information
        tva.id AS assignment_id,
        tva.assigned_at,
        tva.status AS assignment_status,
        tva.created_at,
        tva.updated_at,
        
        -- Vehicle information
        tv.id AS vehicle_id,
        tv.registration_number,
        tv.bus_name,
        tv.model,
        tv.capacity,
        tv.operational_status,
        
        -- Assistant information (from staff)
        tva.assistant_id,
        s.id AS staff_id,
        s.employee_id,
        s.user_id,
        s.job_title,
        s.status AS staff_status,
        
        -- Profile information
        p.full_name AS assistant_name,
        p.first_name,
        p.middle_name,
        p.last_name,
        p.email AS assistant_email,
        p.mobile_number AS assistant_mobile,
        p.residential_address AS assistant_address,
        
        -- School information
        tva.school_id,
        sch.name AS school_name,
        
        -- Assigned by information
        tva.assigned_by,
        assigned_by_profile.full_name AS assigned_by_name
        
    FROM public.transport_vehicle_assistant_assignments tva
    JOIN public.transport_vehicles tv ON tva.vehicle_id = tv.id
    JOIN public.staff s ON tva.assistant_id = s.id
    JOIN public.profiles p ON s.user_id = p.user_id
    JOIN public.schools sch ON tva.school_id = sch.school_id
    LEFT JOIN public.profiles assigned_by_profile ON tva.assigned_by = assigned_by_profile.user_id
    WHERE s.status = 'active'
    AND (school_id_param IS NULL OR tva.school_id = school_id_param)
    ORDER BY tva.assigned_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_vehicle_assistant_assignments"("school_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vehicle_assistants"("school_id_param" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("user_id" "uuid", "role" "text", "full_name" "text", "first_name" "text", "middle_name" "text", "last_name" "text", "email" "text", "mobile_number" "text", "residential_address" "text", "date_of_birth" "date", "sex" "text", "staff_id" "uuid", "employee_id" "text", "hire_date" "date", "job_title" "text", "staff_status" "text", "school_id" "uuid", "school_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        -- User role information
        ur.user_id,
        ur.role::TEXT,
        
        -- Profile information
        p.full_name,
        p.first_name,
        p.middle_name,
        p.last_name,
        p.email,
        p.mobile_number,
        p.residential_address,
        p.date_of_birth,
        p.sex,
        
        -- Staff information
        s.id AS staff_id,
        s.employee_id,
        s.hire_date,
        s.job_title,
        s.status AS staff_status,
        s.school_id,
        
        -- School information
        sch.name AS school_name
        
    FROM public.user_roles ur
    JOIN public.profiles p ON ur.user_id = p.user_id
    JOIN public.staff s ON ur.user_id = s.user_id
    JOIN public.schools sch ON s.school_id = sch.school_id
    WHERE ur.role = 'vehicle_assistant'
    AND s.status = 'active'
    AND (school_id_param IS NULL OR s.school_id = school_id_param)
    ORDER BY p.full_name;
END;
$$;


ALTER FUNCTION "public"."get_vehicle_assistants"("school_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_staff_role_creation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Check if the role is a staff role
  IF NEW.role IN ('teacher', 'librarian', 'driver', 'accountant', 'nurse', 'security_guard', 'janitor', 'other_staff') THEN
    -- Insert staff record if it doesn't exist
    INSERT INTO public.staff (
      user_id,
      status,
      contract_type,
      job_description,
      created_at,
      updated_at
    )
    VALUES (
      NEW.user_id,
      'active',
      'full_time',
      CASE 
        WHEN NEW.role = 'teacher' THEN 'Teacher'
        WHEN NEW.role = 'librarian' THEN 'Librarian'
        WHEN NEW.role = 'driver' THEN 'Driver'
        WHEN NEW.role = 'accountant' THEN 'Accountant'
        WHEN NEW.role = 'nurse' THEN 'Nurse'
        WHEN NEW.role = 'security_guard' THEN 'Security Guard'
        WHEN NEW.role = 'janitor' THEN 'Janitor'
        ELSE 'Other Staff'
      END,
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      job_description = CASE 
        WHEN NEW.role = 'teacher' THEN 'Teacher'
        WHEN NEW.role = 'librarian' THEN 'Librarian'
        WHEN NEW.role = 'driver' THEN 'Driver'
        WHEN NEW.role = 'accountant' THEN 'Accountant'
        WHEN NEW.role = 'nurse' THEN 'Nurse'
        WHEN NEW.role = 'security_guard' THEN 'Security Guard'
        WHEN NEW.role = 'janitor' THEN 'Janitor'
        ELSE 'Other Staff'
      END,
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_staff_role_creation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_access"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 
    CASE 
      -- If user has custom permissions enabled, check specific permissions
      WHEN public.get_user_custom_permissions_enabled(_user_id) THEN
        public.has_permission(_user_id, _module, _operation, _resource)
      -- Otherwise, fall back to role-based access (superadmins can do everything)
      ELSE
        public.has_role(_user_id, 'superadmin'::app_role) OR public.has_role(_user_id, 'admin'::app_role)
    END
$$;


ALTER FUNCTION "public"."has_access"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON up.permission_id = p.permission_id
    WHERE up.user_id = _user_id
      AND p.module = _module
      AND p.operation = _operation
      AND p.resource = _resource
      AND (up.expires_at IS NULL OR up.expires_at > now())
  )
$$;


ALTER FUNCTION "public"."has_permission"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_user"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role IN ('admin', 'superadmin')
  );
END;
$$;


ALTER FUNCTION "public"."is_admin_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_user_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'superadmin')
  );
$$;


ALTER FUNCTION "public"."is_current_user_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_teacher_assigned_to_class"("_user_id" "uuid", "_class_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.teacher_id = _user_id
      and ta.class_id = _class_id
  );
$$;


ALTER FUNCTION "public"."is_teacher_assigned_to_class"("_user_id" "uuid", "_class_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_bulk_permission_change"("p_user_id" "uuid", "p_action" "text", "p_permission_count" integer, "p_template_name" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_school_id UUID;
BEGIN
  -- Get school_id
  SELECT school_id INTO v_school_id
  FROM public.profiles
  WHERE user_id = p_user_id;

  -- Log the bulk operation
  INSERT INTO public.user_permissions_audit (
    user_id,
    permission_id,
    action,
    performed_by,
    school_id,
    metadata
  ) VALUES (
    p_user_id,
    NULL,
    p_action,
    auth.uid(),
    v_school_id,
    jsonb_build_object(
      'permission_count', p_permission_count,
      'template_name', p_template_name
    )
  );
END;
$$;


ALTER FUNCTION "public"."log_bulk_permission_change"("p_user_id" "uuid", "p_action" "text", "p_permission_count" integer, "p_template_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_permission_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_school_id UUID;
  v_permission_details JSONB;
BEGIN
  -- Get school_id from profiles
  SELECT school_id INTO v_school_id
  FROM public.profiles
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);

  -- Get permission details
  IF NEW.permission_id IS NOT NULL OR OLD.permission_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'permission_id', p.permission_id,
      'module', p.module,
      'operation', p.operation,
      'resource', p.resource,
      'description', p.description
    ) INTO v_permission_details
    FROM public.permissions p
    WHERE p.permission_id = COALESCE(NEW.permission_id, OLD.permission_id);
  END IF;

  -- Log based on operation type
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_permissions_audit (
      user_id,
      permission_id,
      action,
      performed_by,
      school_id,
      permission_details,
      metadata
    ) VALUES (
      NEW.user_id,
      NEW.permission_id,
      'granted',
      COALESCE(NEW.granted_by, auth.uid()),
      v_school_id,
      v_permission_details,
      jsonb_build_object(
        'expires_at', NEW.expires_at
      )
    );
    
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.user_permissions_audit (
      user_id,
      permission_id,
      action,
      performed_by,
      school_id,
      permission_details,
      metadata
    ) VALUES (
      OLD.user_id,
      OLD.permission_id,
      'revoked',
      auth.uid(),
      v_school_id,
      v_permission_details,
      '{}'::jsonb
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log expiration changes
    IF OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
      INSERT INTO public.user_permissions_audit (
        user_id,
        permission_id,
        action,
        performed_by,
        school_id,
        permission_details,
        metadata
      ) VALUES (
        NEW.user_id,
        NEW.permission_id,
        'expired',
        auth.uid(),
        v_school_id,
        v_permission_details,
        jsonb_build_object(
          'old_expires_at', OLD.expires_at,
          'new_expires_at', NEW.expires_at
        )
      );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."log_permission_change"() OWNER TO "postgres";


CREATE PROCEDURE "public"."log_promotion"(IN "student_id" "uuid", IN "msg" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    INSERT INTO promotion_logs(student_id, message)
    VALUES(student_id, msg);
END;
$$;


ALTER PROCEDURE "public"."log_promotion"(IN "student_id" "uuid", IN "msg" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_student_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Only log if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO student_status_history (
      student_id,
      school_id,
      old_status,
      new_status,
      changed_by,
      effective_date
    ) VALUES (
      NEW.id,
      NEW.school_id,
      OLD.status,
      NEW.status,
      auth.uid(), -- Current user ID
      CURRENT_DATE
    );
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_student_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_to_next_term"("_school_id" "uuid", "_current_term_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_term RECORD;
  v_next_term RECORD;
BEGIN
  -- Get current term details
  SELECT * INTO v_current_term
  FROM public.terms
  WHERE id = _current_term_id 
    AND school_id = _school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current term not found or access denied';
  END IF;

  -- Find the next term in sequence
  SELECT * INTO v_next_term
  FROM public.terms
  WHERE session_id = v_current_term.session_id
    AND school_id = _school_id
    AND sequence_order = v_current_term.sequence_order + 1
    AND status = 'active';

  -- If no next term found, we're at the end of the sequence
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No next term available. You may be on the final term.';
  END IF;

  -- Set current term to false for the current term
  UPDATE public.terms 
  SET is_current = false 
  WHERE id = _current_term_id;

  -- Set current term to true for the next term
  UPDATE public.terms 
  SET is_current = true 
  WHERE id = v_next_term.id;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."move_to_next_term"("_school_id" "uuid", "_current_term_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."move_to_next_term"("_school_id" "uuid", "_current_term_id" "uuid") IS 'Moves to the next term in sequence within the same session. Only works if there is a next term in the sequence.';



CREATE OR REPLACE FUNCTION "public"."promote_students_sequential"("student_ids" "uuid"[], "effective_date" "date", "reason" "text" DEFAULT 'Promotion'::"text", "notes" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_promoted_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_graduated_count INTEGER := 0;
  v_details JSONB := '[]'::JSONB;
  student_record RECORD;
  v_current_class RECORD;
  v_next_class RECORD;
  v_parent_class RECORD;
  v_parent_next_class RECORD;
  v_current_session RECORD;
  v_next_session RECORD;
  v_current_term RECORD;
BEGIN
  -- Start promotion log
  CALL log_promotion(NULL, format('Starting promotion for %s students (effective_date: %L)', array_length(student_ids, 1), effective_date));

  FOR student_record IN
    SELECT 
      s.*,
      e.class_id AS current_class_id,
      e.session_id AS current_session_id,
      e.term_id AS current_term_id
    FROM students s
    LEFT JOIN LATERAL (
      SELECT class_id, session_id, term_id
      FROM enrollments
      WHERE student_id = s.id
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    ) e ON TRUE
    WHERE s.id = ANY(student_ids)
  LOOP
    CALL log_promotion(student_record.id, format('Processing student: %s (%s)', student_record.first_name || ' ' || student_record.last_name, student_record.id));

    -- Skip non-active students
    IF student_record.status != 'active' THEN
      CALL log_promotion(student_record.id, format('Skipping: student not active (status=%s)', student_record.status));
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', 'Student is not active (current status: ' || student_record.status || ')'
      );
      CONTINUE;
    END IF;

    -- Skip if no active enrollment
    IF student_record.current_class_id IS NULL THEN
      CALL log_promotion(student_record.id, 'Skipping: no active enrollment');
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', 'No active enrollment found'
      );
      CONTINUE;
    END IF;

    -- Get current class details
    SELECT * INTO v_current_class
    FROM classes
    WHERE class_id = student_record.current_class_id;

    CALL log_promotion(student_record.id, format('Current class: %s (type=%s, parent_id=%s, next_class_id=%s, terminal=%s)', 
      v_current_class.name, v_current_class.class_type, v_current_class.parent_class_id, v_current_class.next_class_id, v_current_class.is_terminal));

    -- CRITICAL FIX: If current class is a subclass, resolve progression from parent class
    IF v_current_class.class_type = 'subclass' AND v_current_class.parent_class_id IS NOT NULL THEN
      -- Get parent class info
      SELECT * INTO v_parent_class
      FROM classes
      WHERE class_id = v_current_class.parent_class_id;
      
      IF v_parent_class.class_id IS NOT NULL THEN
        -- Use parent's next_class_id and is_terminal for determining progression
        v_current_class.next_class_id := v_parent_class.next_class_id;
        v_current_class.is_terminal := v_parent_class.is_terminal;
        
        CALL log_promotion(student_record.id, format('Sub-class detected: using parent class %s progression (next_class_id: %s, terminal: %s)', 
          v_parent_class.name, v_parent_class.next_class_id, v_parent_class.is_terminal));
      END IF;
    END IF;

    -- Check for terminal class (graduation)
    IF v_current_class.is_terminal THEN
      CALL log_promotion(student_record.id, 'Terminal class detected: marking as graduated');
      
      -- Update student status to graduated (clear class_id on graduation)
      UPDATE students
      SET 
        status = 'graduated',
        class_id = NULL,
        updated_at = NOW()
      WHERE id = student_record.id;

      -- Mark current enrollment as inactive
      UPDATE enrollments
      SET status = 'inactive', updated_at = NOW()
      WHERE student_id = student_record.id AND status = 'active';

      -- Log status history
      INSERT INTO student_status_history (
        student_id, school_id, old_status, new_status, reason, notes, effective_date, changed_by
      )
      VALUES (
        student_record.id,
        student_record.school_id,
        'active',
        'graduated',
        reason,
        COALESCE(notes, '') || ' | Graduated from ' || v_current_class.name || 
          CASE WHEN v_current_class.sub_class IS NOT NULL THEN ' - ' || v_current_class.sub_class ELSE '' END,
        effective_date,
        auth.uid()
      );

      v_graduated_count := v_graduated_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'graduated',
        'from_class', v_current_class.name || 
          CASE WHEN v_current_class.sub_class IS NOT NULL THEN ' - ' || v_current_class.sub_class ELSE '' END
      );
      CONTINUE;
    END IF;

    -- Check if next_class_id is defined
    IF v_current_class.next_class_id IS NULL THEN
      CALL log_promotion(student_record.id, format('Failed: No next class defined for %s', v_current_class.name));
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', format('No next class defined for %s', v_current_class.name)
      );
      CONTINUE;
    END IF;

    -- Get the next class (umbrella class)
    SELECT * INTO v_parent_next_class
    FROM classes
    WHERE class_id = v_current_class.next_class_id;

    IF v_parent_next_class.class_id IS NULL THEN
      CALL log_promotion(student_record.id, 'Failed: Next class not found in database');
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', 'Next class configuration error'
      );
      CONTINUE;
    END IF;

    -- If current class is a subclass, find the corresponding subclass in the next umbrella class
    IF v_current_class.class_type = 'subclass' AND v_current_class.sub_class IS NOT NULL THEN
      CALL log_promotion(student_record.id, format('Looking for sub-class %s in %s', v_current_class.sub_class, v_parent_next_class.name));
      
      SELECT * INTO v_next_class
      FROM classes
      WHERE parent_class_id = v_parent_next_class.class_id
        AND sub_class = v_current_class.sub_class
        AND class_type = 'subclass';

      IF v_next_class.class_id IS NULL THEN
        CALL log_promotion(student_record.id, format('Failed: No corresponding subclass %s found in %s', 
          v_current_class.sub_class, v_parent_next_class.name));
        v_failed_count := v_failed_count + 1;
        v_details := v_details || jsonb_build_object(
          'student_id', student_record.id,
          'student_name', student_record.first_name || ' ' || student_record.last_name,
          'status', 'failed',
          'reason', format('Sub-class %s does not exist in %s. Create it first or promote manually.', 
            v_current_class.sub_class, v_parent_next_class.name)
        );
        CONTINUE;
      END IF;

      CALL log_promotion(student_record.id, format('Found target sub-class: %s', v_next_class.name));
    ELSE
      -- For umbrella classes, promote to the umbrella next class
      v_next_class := v_parent_next_class;
      CALL log_promotion(student_record.id, format('Umbrella class promotion to: %s', v_next_class.name));
    END IF;

    -- Get current session and determine next session
    SELECT * INTO v_current_session
    FROM academic_sessions
    WHERE id = student_record.current_session_id;

    -- Try to get the next session
    SELECT * INTO v_next_session
    FROM get_next_session(student_record.school_id, v_current_session.id);

    -- If no next session, use current session
    IF v_next_session.id IS NULL THEN
      v_next_session := v_current_session;
      CALL log_promotion(student_record.id, format('No next session found, using current: %s', v_current_session.name));
    ELSE
      CALL log_promotion(student_record.id, format('Moving to next session: %s', v_next_session.name));
    END IF;

    -- Get current term for the new session
    SELECT * INTO v_current_term
    FROM terms
    WHERE school_id = student_record.school_id
      AND is_current = true
    LIMIT 1;

    BEGIN
      -- CRITICAL FIX: Update student's class_id to keep it in sync with enrollment
      UPDATE students
      SET
        class_id = v_next_class.class_id,
        class_level = v_next_class.name,
        section = v_next_class.sub_class,
        updated_at = NOW()
      WHERE id = student_record.id;

      -- Mark current enrollment as inactive
      UPDATE enrollments
      SET status = 'inactive', updated_at = NOW()
      WHERE student_id = student_record.id AND status = 'active';

      -- Create new enrollment
      INSERT INTO enrollments (
        student_id, school_id, session_id, term_id, class_id, class_level, section, status, enrollment_date
      )
      VALUES (
        student_record.id,
        student_record.school_id,
        v_next_session.id,
        COALESCE(v_current_term.id, student_record.current_term_id),
        v_next_class.class_id,
        v_next_class.name,
        v_next_class.sub_class,
        'active',
        effective_date
      );

      -- Log status history
      INSERT INTO student_status_history (
        student_id, school_id, old_status, new_status, reason, notes, effective_date, changed_by
      )
      VALUES (
        student_record.id,
        student_record.school_id,
        student_record.status,
        student_record.status,
        reason,
        COALESCE(notes, '') || ' | Promoted from ' ||
          v_current_class.name ||
          CASE WHEN v_current_class.sub_class IS NOT NULL THEN ' - ' || v_current_class.sub_class ELSE '' END ||
          ' to ' || v_next_class.name ||
          CASE WHEN v_next_class.sub_class IS NOT NULL THEN ' - ' || v_next_class.sub_class ELSE '' END,
        effective_date,
        auth.uid()
      );

      v_promoted_count := v_promoted_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'promoted',
        'from_class', v_current_class.name || 
          CASE WHEN v_current_class.sub_class IS NOT NULL THEN ' - ' || v_current_class.sub_class ELSE '' END,
        'to_class', v_next_class.name ||
          CASE WHEN v_next_class.sub_class IS NOT NULL THEN ' - ' || v_next_class.sub_class ELSE '' END
      );

      CALL log_promotion(student_record.id, format('Success: Promoted to %s', v_next_class.name));

    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', SQLERRM
      );
      CALL log_promotion(student_record.id, format('Failed with error: %s', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'promoted_count', v_promoted_count,
    'graduated_count', v_graduated_count,
    'failed_count', v_failed_count,
    'message', format('Promoted: %s | Graduated: %s | Failed: %s', v_promoted_count, v_graduated_count, v_failed_count),
    'details', v_details
  );
END;
$$;


ALTER FUNCTION "public"."promote_students_sequential"("student_ids" "uuid"[], "effective_date" "date", "reason" "text", "notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_students_to_class"("student_ids" "uuid"[], "target_class_id" "uuid", "target_session_id" "uuid", "target_term_id" "uuid", "reason" "text", "notes" "text", "effective_date" "date") RETURNS TABLE("success" boolean, "promoted_count" integer, "failed_count" integer, "message" "text", "details" "jsonb")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_promoted_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_school_id UUID;
  v_target_class_name TEXT;
  v_target_sub_class TEXT;
  v_details JSONB := '[]'::JSONB;
  student_record RECORD;
BEGIN
  SELECT name, sub_class, school_id
  INTO v_target_class_name, v_target_sub_class, v_school_id
  FROM classes
  WHERE class_id = target_class_id;

  IF v_target_class_name IS NULL THEN
    RETURN QUERY SELECT
      FALSE,
      0,
      0,
      'Target class not found',
      '[]'::JSONB;
    RETURN;
  END IF;

  FOR student_record IN
    SELECT s.*, e.class_level AS current_class, e.section AS current_section
    FROM students s
    LEFT JOIN LATERAL (
      SELECT class_level, section
      FROM enrollments
      WHERE student_id = s.id AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    ) e ON TRUE
    WHERE s.id = ANY(student_ids)
  LOOP
    IF student_record.status != 'active' THEN
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', 'Student is not active (current status: ' || student_record.status || ')'
      );
      CONTINUE;
    END IF;

    BEGIN
      UPDATE students
      SET
        class_level = v_target_class_name,
        section = v_target_sub_class,
        updated_at = NOW()
      WHERE id = student_record.id;

      UPDATE enrollments
      SET status = 'inactive', updated_at = NOW()
      WHERE student_id = student_record.id AND status = 'active';

      INSERT INTO enrollments (
        student_id, school_id, session_id, term_id, class_level, section, status, enrollment_date
      )
      VALUES (
        student_record.id,
        student_record.school_id,
        target_session_id,
        target_term_id,
        v_target_class_name,
        v_target_sub_class,
        'active',
        effective_date
      );

      INSERT INTO student_status_history (
        student_id, school_id, old_status, new_status, reason, notes, effective_date, changed_by
      )
      VALUES (
        student_record.id,
        student_record.school_id,
        student_record.status,
        student_record.status,
        reason,
        COALESCE(notes, '') || ' | Promoted from ' ||
          COALESCE(student_record.current_class ||
            CASE WHEN student_record.current_section IS NOT NULL
              THEN ' - ' || student_record.current_section
              ELSE ''
            END, 'N/A') ||
          ' to ' || v_target_class_name ||
          CASE WHEN v_target_sub_class IS NOT NULL
            THEN ' - ' || v_target_sub_class
            ELSE ''
          END,
        effective_date,
        auth.uid()
      );

      v_promoted_count := v_promoted_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'success',
        'from_class', COALESCE(student_record.current_class, 'Not Enrolled'),
        'to_class', v_target_class_name ||
          CASE WHEN v_target_sub_class IS NOT NULL
            THEN ' - ' || v_target_sub_class
            ELSE ''
          END
      );

    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
      v_details := v_details || jsonb_build_object(
        'student_id', student_record.id,
        'student_name', student_record.first_name || ' ' || student_record.last_name,
        'status', 'failed',
        'reason', SQLERRM
      );
    END;
  END LOOP;

  RETURN QUERY SELECT
    TRUE,
    v_promoted_count,
    v_failed_count,
    format('Successfully promoted %s student(s). %s failed.',
      v_promoted_count, v_failed_count),
    v_details;
END;
$$;


ALTER FUNCTION "public"."promote_students_to_class"("student_ids" "uuid"[], "target_class_id" "uuid", "target_session_id" "uuid", "target_term_id" "uuid", "reason" "text", "notes" "text", "effective_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_current_session"("_school_id" "uuid", "_session_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only admins and superadmins can set current session
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can set current session';
  END IF;

  -- First, set all sessions for this school to not current
  UPDATE public.academic_sessions 
  SET is_current = false 
  WHERE school_id = _school_id;

  -- Then set the specified session as current
  UPDATE public.academic_sessions 
  SET is_current = true 
  WHERE id = _session_id AND school_id = _school_id;

  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."set_current_session"("_school_id" "uuid", "_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_current_term"("_school_id" "uuid", "_term_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only admins and superadmins can set current term
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can set current term';
  END IF;

  -- First, set all terms for this school to not current
  UPDATE public.terms 
  SET is_current = false 
  WHERE school_id = _school_id;

  -- Then set the specified term as current
  UPDATE public.terms 
  SET is_current = true 
  WHERE id = _term_id AND school_id = _school_id;

  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Term not found or access denied';
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."set_current_term"("_school_id" "uuid", "_term_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_emergency_contact_school_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Set school_id from the linked student if not provided
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id
    FROM public.students s
    WHERE s.id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_emergency_contact_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_fee_account_school_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Set school context from the linked student if not provided
  IF NEW.school_id IS NULL THEN
    SELECT s.school_id INTO NEW.school_id
    FROM public.students s
    WHERE s.id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_fee_account_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_fee_tx_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_school_id UUID;
BEGIN
  -- Set recorded_by from current user if not provided
  IF NEW.recorded_by IS NULL THEN
    NEW.recorded_by := auth.uid();
  END IF;

  -- Set school_id from the account if not provided
  IF NEW.school_id IS NULL THEN
    SELECT fa.school_id INTO v_school_id
    FROM public.fee_accounts fa
    WHERE fa.id = NEW.account_id;

    NEW.school_id := v_school_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_fee_tx_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_parent_link_school_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT s.school_id INTO NEW.school_id
    FROM public.students s
    WHERE s.id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_parent_link_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_parent_links_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_parent_links_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_parent_school_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Set school_id from the user's profile if not provided
  IF NEW.school_id IS NULL THEN
    SELECT p.school_id INTO NEW.school_id
    FROM public.profiles p
    WHERE p.user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_parent_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_session_sequence_order"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Auto-increment sequence_order based on existing sessions for this school
  IF NEW.sequence_order IS NULL THEN
    SELECT COALESCE(MAX(sequence_order), 0) + 1 
    INTO NEW.sequence_order
    FROM academic_sessions 
    WHERE school_id = NEW.school_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_session_sequence_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_teacher_school_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Set school_id from the profile if not provided
  IF NEW.school_id IS NULL THEN
    SELECT p.school_id INTO NEW.school_id
    FROM public.profiles p
    WHERE p.id = NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_teacher_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."setup_superadmin_after_signup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Check if this is the superadmin email
  IF NEW.email = 'admin@newhope.school' THEN
    -- Create profile if not exists
    INSERT INTO public.profiles (user_id, full_name, email, custom_permissions_enabled)
    VALUES (NEW.id, 'New Hope Administrator', NEW.email, false)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- Assign superadmin role if not exists
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'superadmin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."setup_superadmin_after_signup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_asset_quantity_on_txn"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.assets
  SET quantity = COALESCE(quantity,0) + NEW.quantity,
      updated_at = now()
  WHERE asset_id = NEW.asset_id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_asset_quantity_on_txn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_account_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Update the account balance
    UPDATE public.fee_accounts
    SET current_balance = current_balance + NEW.amount_effective,
        updated_at = NOW()
    WHERE id = NEW.account_id;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_account_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_deduction_types_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_deduction_types_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_driver_ride_history_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_driver_ride_history_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_drivers_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_drivers_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_library_book_availability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.transaction_type = 'borrow' AND NEW.status = 'active' THEN
    -- Decrease available copies when book is borrowed
    UPDATE library_books 
    SET copies_available = GREATEST(copies_available - 1, 0)
    WHERE id = NEW.book_id;
  ELSIF OLD.status = 'active' AND NEW.status = 'returned' THEN
    -- Increase available copies when book is returned
    UPDATE library_books 
    SET copies_available = LEAST(copies_available + 1, copies_total)
    WHERE id = NEW.book_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_library_book_availability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_tips_state_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_tips_state_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_loan_application"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_config loan_type_configs%ROWTYPE;
    v_active_loans INTEGER;
    v_employment_months INTEGER;
BEGIN
    -- Get loan type config
    SELECT * INTO v_config 
    FROM loan_type_configs 
    WHERE id = NEW.loan_type_config_id;
    
    -- Check amount limits
    IF NEW.amount < v_config.min_amount OR NEW.amount > v_config.max_amount THEN
        RAISE EXCEPTION 'Loan amount must be between % and %', 
            v_config.min_amount, v_config.max_amount;
    END IF;
    
    -- Check tenure limits
    IF NEW.tenure < v_config.min_tenure OR NEW.tenure > v_config.max_tenure THEN
        RAISE EXCEPTION 'Loan tenure must be between % and % months', 
            v_config.min_tenure, v_config.max_tenure;
    END IF;
    
    -- Check active loans count
    SELECT COUNT(*) INTO v_active_loans 
    FROM loans l
    JOIN loan_applications la ON la.id = l.loan_application_id
    WHERE l.staff_id = NEW.staff_id 
    AND la.loan_type_config_id = NEW.loan_type_config_id
    AND l.status = 'active';
    
    IF v_active_loans >= v_config.max_active_loans THEN
        RAISE EXCEPTION 'Maximum number of active loans reached';
    END IF;
    
    -- Check employment duration
    SELECT 
        EXTRACT(YEAR FROM age(now(), date_employed)) * 12 +
        EXTRACT(MONTH FROM age(now(), date_employed))
    INTO v_employment_months 
    FROM staff 
    WHERE id = NEW.staff_id;
    
    IF v_employment_months < v_config.eligibility_months THEN
        RAISE EXCEPTION 'Minimum employment duration not met';
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_loan_application"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_policy_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Validate that policy_id references the correct table based on policy_type
  IF NEW.policy_type = 'grading' THEN
    -- Check if policy_id exists in grading_policies
    IF NOT EXISTS (SELECT 1 FROM public.grading_policies WHERE id = NEW.policy_id) THEN
      RAISE EXCEPTION 'Invalid policy_id for grading policy type';
    END IF;
  ELSIF NEW.policy_type = 'assessment' THEN
    -- Check if policy_id exists in assessment_types
    IF NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE id = NEW.policy_id) THEN
      RAISE EXCEPTION 'Invalid policy_id for assessment policy type';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_policy_assignment"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."academic_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sequence_order" integer,
    CONSTRAINT "academic_sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."academic_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "adjustment_number" "text" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid",
    "class_id" "uuid",
    "department_id" "uuid",
    "bill_id" "uuid",
    "amount" numeric DEFAULT 0 NOT NULL,
    "transaction_type" "text" DEFAULT 'credit'::"text" NOT NULL,
    "adjustment_type" "text" DEFAULT 'credit_adjustment'::"text" NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "adjustments_adjustment_type_check" CHECK (("adjustment_type" = ANY (ARRAY['credit_adjustment'::"text", 'debit_adjustment'::"text"]))),
    CONSTRAINT "adjustments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "adjustments_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['credit'::"text", 'debit'::"text"])))
);


ALTER TABLE "public"."adjustments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."adjustments"."transaction_type" IS 'Type of transaction: credit (money coming in) or debit (money going out)';



COMMENT ON COLUMN "public"."adjustments"."adjustment_type" IS 'Type of adjustment: credit_adjustment or debit_adjustment';



COMMENT ON COLUMN "public"."adjustments"."reason" IS 'Reason for the adjustment';



COMMENT ON COLUMN "public"."adjustments"."status" IS 'Status of the adjustment: pending, confirmed, or rejected';



CREATE TABLE IF NOT EXISTS "public"."assessment_publications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "publication_type" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "published_by" "uuid",
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assessment_publications_publication_type_check" CHECK (("publication_type" = ANY (ARRAY['interim'::"text", 'term_end'::"text", 'annual'::"text"]))),
    CONSTRAINT "assessment_publications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'review'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."assessment_publications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessment_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_type_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "subject_id" "uuid",
    "marks_obtained" numeric,
    "percentage" numeric,
    "grade" "text",
    "remarks" "text",
    "assessed_by" "uuid",
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."assessment_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessment_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "weight" numeric DEFAULT 0 NOT NULL,
    "applies_to" "text" NOT NULL,
    "applies_to_details" "text",
    "status" "text" DEFAULT 'active'::"text",
    "school_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_descriptive_set" boolean DEFAULT false,
    "grading_policy_id" "uuid",
    "max_marks" numeric DEFAULT 100,
    CONSTRAINT "assessment_types_applies_to_check" CHECK (("applies_to" = ANY (ARRAY['all'::"text", 'department'::"text", 'class'::"text", 'group'::"text"]))),
    CONSTRAINT "assessment_types_max_marks_check" CHECK (("max_marks" > (0)::numeric)),
    CONSTRAINT "assessment_types_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"]))),
    CONSTRAINT "assessment_types_weight_check" CHECK ((("weight" >= (0)::numeric) AND ("weight" <= (100)::numeric)))
);


ALTER TABLE "public"."assessment_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "assigned_to" character varying(255) NOT NULL,
    "assigned_from" character varying(255),
    "assignment_date" "date" NOT NULL,
    "expected_return" "date",
    "actual_return" "date",
    "status" character varying(50) NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "asset_assignments_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Active'::character varying, 'Completed'::character varying, 'Overdue'::character varying])::"text"[])))
);


ALTER TABLE "public"."asset_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asset_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_depreciation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "depreciation_year" integer NOT NULL,
    "purchase_cost" numeric(10,2) NOT NULL,
    "annual_depreciation" numeric(10,2) NOT NULL,
    "accumulated_depreciation" numeric(10,2) NOT NULL,
    "book_value" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asset_depreciation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_maintenance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "maintenance_date" "date" NOT NULL,
    "maintenance_type" character varying(100) NOT NULL,
    "vendor" character varying(255),
    "cost" numeric(10,2),
    "description" "text",
    "next_service_date" "date",
    "status" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "asset_maintenance_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Scheduled'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."asset_maintenance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "from_location" character varying(255),
    "to_location" character varying(255),
    "from_person" character varying(255),
    "to_person" character varying(255),
    "movement_date" "date" NOT NULL,
    "moved_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asset_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "asset_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "category" "text",
    "sku" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "brand" "text",
    "model" "text",
    "serial_number" "text",
    "purchase_price" numeric(10,2),
    "purchase_date" "date",
    "condition" "text",
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit" "text",
    "reorder_threshold" integer DEFAULT 5,
    "metadata" "jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "added_by_staff_id" "uuid",
    "updated_by_staff_id" "uuid"
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid",
    "staff_id" "uuid",
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "text" NOT NULL,
    "check_in_time" time without time zone,
    "check_out_time" time without time zone,
    "notes" "text",
    "marked_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "class_id" "uuid",
    "subject_id" "uuid",
    CONSTRAINT "attendance_person_check" CHECK (((("student_id" IS NOT NULL) AND ("staff_id" IS NULL)) OR (("student_id" IS NULL) AND ("staff_id" IS NOT NULL)))),
    CONSTRAINT "attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text", 'excused'::"text"])))
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "class_id" "uuid",
    "subject_id" "uuid",
    "session_name" "text" NOT NULL,
    "session_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid"
);


ALTER TABLE "public"."attendance_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bill_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_number" "text" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid",
    "class_id" "uuid",
    "department_id" "uuid",
    "term_id" "uuid",
    "session_id" "uuid",
    "due_date" "date" NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "discount_type" "text" DEFAULT 'none'::"text",
    "discount_value" numeric DEFAULT 0,
    "tax_type" "text" DEFAULT 'none'::"text",
    "tax_value" numeric DEFAULT 0,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "notes" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bills_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['none'::"text", 'percentage'::"text", 'fixed'::"text"]))),
    CONSTRAINT "bills_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "bills_tax_type_check" CHECK (("tax_type" = ANY (ARRAY['none'::"text", 'percentage'::"text", 'fixed'::"text"])))
);


ALTER TABLE "public"."bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."borrowing_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "borrower_staff_id" "uuid",
    "borrower_name" "text",
    "borrower_id" "text",
    "borrow_date" "date" DEFAULT "now"() NOT NULL,
    "due_date" "date",
    "return_date" "date",
    "status" "text" DEFAULT 'active'::"text",
    "notes" "text",
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."borrowing_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "event_type" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_all_day" boolean DEFAULT false,
    "location" "text",
    "color" "text",
    CONSTRAINT "calendar_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['admin'::"text", 'system'::"text", 'personal'::"text"])))
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_subjects" (
    "class_subject_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."class_subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_teacher_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "academic_year_id" "uuid",
    "start_date" "date" DEFAULT CURRENT_DATE,
    "end_date" "date",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."class_teacher_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classes" (
    "class_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "sub_class" "text",
    "department_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid",
    "grade_level" "text",
    "class_teacher_id" "uuid",
    "parent_class_id" "uuid",
    "is_subclass" boolean DEFAULT false,
    "class_type" "text" DEFAULT 'umbrella'::"text",
    "description" "text",
    "sequence_order" integer,
    "next_class_id" "uuid",
    "is_terminal" boolean DEFAULT false,
    CONSTRAINT "classes_class_type_check" CHECK (("class_type" = ANY (ARRAY['umbrella'::"text", 'subclass'::"text"])))
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."classes"."sequence_order" IS 'Sequential order of classes within a department (e.g., 1 for Primary 1, 2 for Primary 2). Used for automatic promotion.';



COMMENT ON COLUMN "public"."classes"."next_class_id" IS 'References the next class in the progression path. NULL for terminal classes (final year).';



COMMENT ON COLUMN "public"."classes"."is_terminal" IS 'Indicates if this is the final class in the progression path (e.g., JHS 3, SHS 3). Students are graduated upon promotion from this class.';



CREATE TABLE IF NOT EXISTS "public"."enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_level" "text",
    "section" "text",
    "academic_year" "text",
    "enrollment_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "class_id" "uuid",
    "school_id" "uuid",
    "session_id" "uuid",
    "term_id" "uuid",
    CONSTRAINT "enrollments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'transferred'::"text", 'graduated'::"text"])))
);


ALTER TABLE "public"."enrollments" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."classes_with_counts" AS
 SELECT "c"."class_id",
    "c"."name",
    "c"."sub_class",
    "c"."grade_level",
    "c"."school_id",
    "count"(DISTINCT "e"."student_id") AS "student_count",
    "count"(DISTINCT
        CASE
            WHEN ("e"."status" = 'active'::"text") THEN "e"."student_id"
            ELSE NULL::"uuid"
        END) AS "active_student_count"
   FROM ("public"."classes" "c"
     LEFT JOIN "public"."enrollments" "e" ON ((("e"."class_level" = "c"."name") AND (("c"."sub_class" IS NULL) OR ("e"."section" = "c"."sub_class")) AND ("e"."school_id" = "c"."school_id"))))
  GROUP BY "c"."class_id", "c"."name", "c"."sub_class", "c"."grade_level", "c"."school_id";


ALTER VIEW "public"."classes_with_counts" OWNER TO "postgres";


COMMENT ON VIEW "public"."classes_with_counts" IS 'Classes with student enrollment counts for easy reference';



CREATE TABLE IF NOT EXISTS "public"."departments" (
    "department_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "head_of_department" "uuid",
    "budget" numeric(15,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid"
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_ride_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "route_id" "uuid",
    "ride_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "start_location" "text",
    "end_location" "text",
    "distance_km" numeric(8,2),
    "fuel_consumed_liters" numeric(8,2),
    "students_count" integer DEFAULT 0,
    "ride_status" character varying(20) DEFAULT 'Scheduled'::character varying,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "driver_ride_history_ride_status_check" CHECK ((("ride_status")::"text" = ANY ((ARRAY['Scheduled'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."driver_ride_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."driver_ride_history" IS 'Tracks ride history and trips completed by drivers';



COMMENT ON COLUMN "public"."driver_ride_history"."ride_date" IS 'Date of the ride/trip';



COMMENT ON COLUMN "public"."driver_ride_history"."start_time" IS 'Time when the ride started';



COMMENT ON COLUMN "public"."driver_ride_history"."end_time" IS 'Time when the ride ended';



COMMENT ON COLUMN "public"."driver_ride_history"."distance_km" IS 'Total distance covered in kilometers';



COMMENT ON COLUMN "public"."driver_ride_history"."fuel_consumed_liters" IS 'Fuel consumed during the trip in liters';



COMMENT ON COLUMN "public"."driver_ride_history"."students_count" IS 'Number of students transported';



COMMENT ON COLUMN "public"."driver_ride_history"."ride_status" IS 'Status of the ride: Scheduled, In Progress, Completed, or Cancelled';



CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "staff_id" "uuid",
    "license_number" character varying(50) NOT NULL,
    "license_expiry_date" "date",
    "residential_address" "text",
    "assigned_bus_id" "uuid",
    "employment_status" character varying(20) DEFAULT 'Active'::character varying,
    "hire_date" "date" DEFAULT CURRENT_DATE,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "license_type" character varying(20),
    CONSTRAINT "drivers_employment_status_check" CHECK ((("employment_status")::"text" = ANY ((ARRAY['Active'::character varying, 'On Leave'::character varying, 'Suspended'::character varying])::"text"[]))),
    CONSTRAINT "drivers_license_type_check" CHECK ((("license_type")::"text" = ANY ((ARRAY['class_a'::character varying, 'class_b'::character varying, 'class_c'::character varying, 'commercial'::character varying, 'motorcycle'::character varying])::"text"[])))
);


ALTER TABLE "public"."drivers" OWNER TO "postgres";


COMMENT ON TABLE "public"."drivers" IS 'Stores driver-specific information for staff members with driver role';



COMMENT ON COLUMN "public"."drivers"."license_number" IS 'Official driving license number (unique per school)';



COMMENT ON COLUMN "public"."drivers"."license_expiry_date" IS 'Expiry date of the driving license';



COMMENT ON COLUMN "public"."drivers"."residential_address" IS 'Home address of the driver';



COMMENT ON COLUMN "public"."drivers"."assigned_bus_id" IS 'Currently assigned vehicle/bus';



COMMENT ON COLUMN "public"."drivers"."employment_status" IS 'Current employment status: Active, On Leave, or Suspended';



COMMENT ON COLUMN "public"."drivers"."hire_date" IS 'Date when the driver was hired';



CREATE TABLE IF NOT EXISTS "public"."emergency_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "contact_name" "text" NOT NULL,
    "relationship" "text" NOT NULL,
    "phone_primary" "text" NOT NULL,
    "phone_secondary" "text",
    "email" "text",
    "address" "text",
    "is_emergency_contact" boolean DEFAULT true NOT NULL,
    "can_pickup_student" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid"
);


ALTER TABLE "public"."emergency_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "recipient_type" "text" NOT NULL,
    "recipient_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_recipients_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['all_staff'::"text", 'all_teachers'::"text", 'all_parents'::"text", 'department'::"text", 'class'::"text", 'staff_member'::"text"])))
);


ALTER TABLE "public"."event_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "exam_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "marks_obtained" numeric DEFAULT 0,
    "percentage" numeric DEFAULT 0,
    "grade" "text",
    "remarks" "text",
    "graded_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."exam_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'assessment'::"text",
    "subject_id" "uuid",
    "class_id" "uuid",
    "exam_date" "date",
    "start_time" time without time zone,
    "end_time" time without time zone,
    "total_marks" numeric DEFAULT 100,
    "status" "text" DEFAULT 'scheduled'::"text",
    "venue" "text",
    "instructions" "text",
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."exams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fee_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "account_number" "text",
    "opening_balance" numeric(10,2) DEFAULT 0,
    "current_balance" numeric(10,2) DEFAULT 0,
    "currency" "text" DEFAULT 'GHS'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fee_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fee_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "amount_effective" numeric(10,2),
    "transaction_date" "date" DEFAULT CURRENT_DATE,
    "description" "text",
    "payment_method" "text",
    "reference_number" "text",
    "recorded_by" "uuid",
    "adjustment_direction" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "session_id" "uuid",
    "term_id" "uuid",
    CONSTRAINT "fee_transactions_adjustment_direction_check" CHECK (("adjustment_direction" = ANY (ARRAY['increase'::"text", 'decrease'::"text"]))),
    CONSTRAINT "fee_transactions_type_check" CHECK (("type" = ANY (ARRAY['charge'::"text", 'payment'::"text", 'adjustment'::"text", 'refund'::"text"])))
);


ALTER TABLE "public"."fee_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fixed_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "asset_id" character varying(50) NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "category" character varying(100) NOT NULL,
    "serial_number" character varying(100),
    "model" character varying(100),
    "purchase_date" "date" NOT NULL,
    "purchase_cost" numeric(10,2) NOT NULL,
    "supplier" character varying(255),
    "useful_life" integer NOT NULL,
    "condition" character varying(50) NOT NULL,
    "status" character varying(50) NOT NULL,
    "location" character varying(255),
    "responsible_person" character varying(255),
    "tag_code" character varying(100),
    "warranty_expiry" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "fixed_assets_condition_check" CHECK ((("condition")::"text" = ANY ((ARRAY['New'::character varying, 'Good'::character varying, 'Fair'::character varying, 'Poor'::character varying, 'Damaged'::character varying])::"text"[]))),
    CONSTRAINT "fixed_assets_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Active'::character varying, 'Under Repair'::character varying, 'Lost'::character varying, 'Disposed'::character varying])::"text"[])))
);


ALTER TABLE "public"."fixed_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grading_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "scope_details" "text",
    "grading_type" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "school_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "grading_policies_grading_type_check" CHECK (("grading_type" = ANY (ARRAY['percentage'::"text", 'letter'::"text", 'descriptive'::"text", 'points'::"text"]))),
    CONSTRAINT "grading_policies_scope_check" CHECK (("scope" = ANY (ARRAY['department'::"text", 'class'::"text", 'group'::"text"]))),
    CONSTRAINT "grading_policies_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."grading_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grading_policy_grades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "grade" "text" NOT NULL,
    "minimum_value" numeric,
    "maximum_value" numeric,
    "remark" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."grading_policy_grades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_message_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid",
    "user_id" "uuid",
    "can_send_messages" boolean DEFAULT false,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."group_message_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "group_id" "uuid",
    "last_read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."group_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_public" boolean DEFAULT true,
    "is_announcement" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "school_id" "uuid"
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_borrowing_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid",
    "school_id" "uuid",
    "borrower_name" character varying(255) NOT NULL,
    "borrower_id" character varying(100),
    "borrow_date" "date" DEFAULT CURRENT_DATE,
    "expected_return_date" "date",
    "return_date" "date",
    "quantity" integer DEFAULT 1 NOT NULL,
    "condition_on_issue" "text",
    "condition_on_return" "text",
    "notes" "text",
    "status" character varying(20) DEFAULT 'active'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "inventory_borrowing_transactions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'returned'::character varying, 'overdue'::character varying])::"text"[])))
);


ALTER TABLE "public"."inventory_borrowing_transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."inventory_borrower_history" AS
 SELECT "borrower_name",
    "borrower_id",
    "school_id",
    "count"(*) AS "total_borrows",
    "count"(
        CASE
            WHEN (("status")::"text" = 'returned'::"text") THEN 1
            ELSE NULL::integer
        END) AS "completed_returns",
    "count"(
        CASE
            WHEN (("status")::"text" = 'active'::"text") THEN 1
            ELSE NULL::integer
        END) AS "active_loans",
    "count"(
        CASE
            WHEN (("status")::"text" = 'overdue'::"text") THEN 1
            ELSE NULL::integer
        END) AS "overdue_loans"
   FROM "public"."inventory_borrowing_transactions" "bt"
  GROUP BY "borrower_name", "borrower_id", "school_id";


ALTER VIEW "public"."inventory_borrower_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "item_code" character varying(50) NOT NULL,
    "name" character varying(255) NOT NULL,
    "category" character varying(100) NOT NULL,
    "description" "text",
    "unit_of_measure" character varying(50),
    "reorder_point" integer DEFAULT 0,
    "stock_type" character varying(20) NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "inventory_items_stock_type_check" CHECK ((("stock_type")::"text" = ANY ((ARRAY['Consumable'::character varying, 'Returnable'::character varying])::"text"[])))
);


ALTER TABLE "public"."inventory_items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."inventory_condition_report" AS
 SELECT "i"."id" AS "item_id",
    "i"."school_id",
    "i"."item_code",
    "i"."name" AS "item_name",
    "i"."stock_type",
    "count"("bt"."id") AS "total_borrows",
    "count"(
        CASE
            WHEN ("bt"."condition_on_return" IS NOT NULL) THEN 1
            ELSE NULL::integer
        END) AS "returns_with_condition",
    "avg"(
        CASE
            WHEN (("bt"."condition_on_issue" ~~* '%good%'::"text") OR ("bt"."condition_on_issue" ~~* '%excellent%'::"text")) THEN 5
            WHEN ("bt"."condition_on_issue" ~~* '%fair%'::"text") THEN 3
            WHEN (("bt"."condition_on_issue" ~~* '%poor%'::"text") OR ("bt"."condition_on_issue" ~~* '%damaged%'::"text")) THEN 1
            ELSE 3
        END) AS "avg_condition_on_issue",
    "avg"(
        CASE
            WHEN (("bt"."condition_on_return" ~~* '%good%'::"text") OR ("bt"."condition_on_return" ~~* '%excellent%'::"text")) THEN 5
            WHEN ("bt"."condition_on_return" ~~* '%fair%'::"text") THEN 3
            WHEN (("bt"."condition_on_return" ~~* '%poor%'::"text") OR ("bt"."condition_on_return" ~~* '%damaged%'::"text")) THEN 1
            ELSE NULL::integer
        END) AS "avg_condition_on_return"
   FROM ("public"."inventory_items" "i"
     LEFT JOIN "public"."inventory_borrowing_transactions" "bt" ON (("i"."id" = "bt"."item_id")))
  WHERE (("i"."stock_type")::"text" = 'Returnable'::"text")
  GROUP BY "i"."id", "i"."school_id", "i"."item_code", "i"."name", "i"."stock_type";


ALTER VIEW "public"."inventory_condition_report" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid",
    "school_id" "uuid",
    "transaction_type" character varying(20) NOT NULL,
    "quantity" integer NOT NULL,
    "location" character varying(100),
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "borrower_name" character varying(255),
    "borrower_id" character varying(100),
    "expected_return_date" "date",
    "condition_on_issue" "text",
    "return_date" "date",
    "condition_on_return" "text",
    "related_transaction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "inventory_transactions_transaction_type_check" CHECK ((("transaction_type")::"text" = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying, 'RETURN'::character varying])::"text"[])))
);


ALTER TABLE "public"."inventory_transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."inventory_current_stock" AS
 SELECT "i"."id" AS "item_id",
    "i"."school_id",
    "i"."item_code",
    "i"."name" AS "item_name",
    "i"."stock_type",
    "i"."unit_of_measure",
    COALESCE("sum"(
        CASE
            WHEN (("t"."transaction_type")::"text" = 'IN'::"text") THEN "t"."quantity"
            WHEN (("t"."transaction_type")::"text" = 'OUT'::"text") THEN (- "t"."quantity")
            WHEN (("t"."transaction_type")::"text" = 'RETURN'::"text") THEN "t"."quantity"
            ELSE 0
        END), (0)::bigint) AS "current_quantity",
    "max"(("t"."location")::"text") AS "location",
    "max"("t"."performed_at") AS "last_updated"
   FROM ("public"."inventory_items" "i"
     LEFT JOIN "public"."inventory_transactions" "t" ON (("i"."id" = "t"."item_id")))
  WHERE ("i"."is_active" = true)
  GROUP BY "i"."id", "i"."school_id", "i"."item_code", "i"."name", "i"."stock_type", "i"."unit_of_measure";


ALTER VIEW "public"."inventory_current_stock" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."inventory_outstanding_loans" AS
 SELECT "bt"."id",
    "bt"."school_id",
    "bt"."item_id",
    "i"."item_code",
    "i"."name" AS "item_name",
    "bt"."borrower_name",
    "bt"."borrower_id",
    "bt"."borrow_date",
    "bt"."expected_return_date",
    "bt"."quantity",
    "bt"."condition_on_issue",
    "bt"."notes",
    "bt"."status",
    "bt"."created_at"
   FROM ("public"."inventory_borrowing_transactions" "bt"
     JOIN "public"."inventory_items" "i" ON (("bt"."item_id" = "i"."id")))
  WHERE (("bt"."status")::"text" = 'active'::"text");


ALTER VIEW "public"."inventory_outstanding_loans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."library_books" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "author" "text" NOT NULL,
    "isbn" "text",
    "category" "text" NOT NULL,
    "status" "text" DEFAULT 'available'::"text",
    "location" "text",
    "publication_year" integer,
    "copies_total" integer DEFAULT 1,
    "copies_available" integer DEFAULT 1,
    "school_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."library_books" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."library_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "school_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."library_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."library_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "book_id" "uuid" NOT NULL,
    "borrower_id" "uuid" NOT NULL,
    "borrower_type" "text" DEFAULT 'student'::"text",
    "transaction_type" "text" NOT NULL,
    "borrow_date" "date" DEFAULT CURRENT_DATE,
    "due_date" "date",
    "return_date" "date",
    "fine_amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text",
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "staff_borrower_id" "uuid",
    "notes" "text",
    "quantity_borrowed" "text",
    "book_condition" "text"
);


ALTER TABLE "public"."library_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "principal_amount" numeric NOT NULL,
    "monthly_payment" numeric NOT NULL,
    "remaining_balance" numeric NOT NULL,
    "start_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "loans_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'defaulted'::"text"])))
);


ALTER TABLE "public"."loans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "school_id" "uuid"
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "recipient_email" "text" NOT NULL,
    "recipient_user_id" "uuid",
    "notification_type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'sent'::"text",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "school_id" "uuid",
    "email_enabled" boolean DEFAULT true,
    "session_notifications" boolean DEFAULT true,
    "calendar_notifications" boolean DEFAULT true,
    "permission_notifications" boolean DEFAULT true,
    "student_notifications" boolean DEFAULT true,
    "staff_notifications" boolean DEFAULT true,
    "academic_notifications" boolean DEFAULT true,
    "attendance_notifications" boolean DEFAULT true,
    "assessment_notifications" boolean DEFAULT true,
    "billing_notifications" boolean DEFAULT true,
    "transport_notifications" boolean DEFAULT true,
    "payroll_notifications" boolean DEFAULT true,
    "reminder_days_before" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parent_student_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_user_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "relationship" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone_number" "text"
);


ALTER TABLE "public"."parent_student_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "occupation" "text",
    "emergency_contact" "text",
    "relationship_to_student" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid"
);


ALTER TABLE "public"."parents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "payroll_period_id" "uuid",
    "batch_reference" "text" NOT NULL,
    "total_amount" numeric(12,2) NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text"
);


ALTER TABLE "public"."payment_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "staff_id" "uuid",
    "method_type" "public"."payment_method_type" NOT NULL,
    "is_default" boolean DEFAULT false,
    "bank_name" "text",
    "account_number" "text",
    "account_name" "text",
    "branch" "text",
    "swift_code" "text",
    "mobile_provider" "public"."mobile_money_provider",
    "mobile_number" "text",
    "mobile_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    CONSTRAINT "valid_bank_details" CHECK (((("method_type" = 'bank_transfer'::"public"."payment_method_type") AND ("bank_name" IS NOT NULL) AND ("account_number" IS NOT NULL)) OR ("method_type" <> 'bank_transfer'::"public"."payment_method_type"))),
    CONSTRAINT "valid_mobile_details" CHECK (((("method_type" = 'mobile_money'::"public"."payment_method_type") AND ("mobile_provider" IS NOT NULL) AND ("mobile_number" IS NOT NULL)) OR ("method_type" <> 'mobile_money'::"public"."payment_method_type")))
);


ALTER TABLE "public"."payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "installment_number" integer NOT NULL,
    "due_date" "date" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payment_plans_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."payment_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "staff_id" "uuid",
    "payroll_period_id" "uuid",
    "payment_batch_id" "uuid",
    "payment_method_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status",
    "transaction_reference" "text",
    "provider_reference" "text",
    "provider_status" "text",
    "provider_message" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text"
);


ALTER TABLE "public"."payment_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_number" "text" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "bill_id" "uuid",
    "amount" numeric DEFAULT 0 NOT NULL,
    "payment_method" "text" NOT NULL,
    "reference_number" "text",
    "payment_date" "date" NOT NULL,
    "narration" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cashier_name" "text",
    "term_id" "uuid",
    "session_id" "uuid",
    "account_balance" numeric(12,2) DEFAULT 0.00,
    "transaction_type" "text" DEFAULT 'credit'::"text",
    CONSTRAINT "payments_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'cheque'::"text", 'bank_transfer'::"text", 'mobile_money'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "payments_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['credit'::"text", 'debit'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payments"."transaction_type" IS 'Type of transaction: credit (payment/receipt) or debit (adjustment/refund)';



CREATE TABLE IF NOT EXISTS "public"."payroll_allowances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric DEFAULT 0.0 NOT NULL,
    "is_percentage" boolean DEFAULT false,
    "percentage_value" numeric,
    "applicable_base" "text",
    "is_taxable" boolean DEFAULT true,
    "is_recurring" boolean DEFAULT true,
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "end_date" "date",
    "applicable_to" "text" NOT NULL,
    "department_id" "uuid",
    "staff_id" "uuid",
    "status" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "payroll_allowances_applicable_base_check" CHECK (("applicable_base" = ANY (ARRAY['basic'::"text", 'basic_allowances'::"text", 'gross'::"text"]))),
    CONSTRAINT "payroll_allowances_applicable_to_check" CHECK (("applicable_to" = ANY (ARRAY['all'::"text", 'department'::"text", 'individual'::"text"])))
);


ALTER TABLE "public"."payroll_allowances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_component_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "component_type" "text" NOT NULL,
    "component_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "changed_fields" "jsonb",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payroll_component_audit_log_action_check" CHECK (("action" = ANY (ARRAY['create'::"text", 'update'::"text", 'deactivate'::"text"]))),
    CONSTRAINT "payroll_component_audit_log_component_type_check" CHECK (("component_type" = ANY (ARRAY['allowance'::"text", 'deduction'::"text"])))
);


ALTER TABLE "public"."payroll_component_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_deductions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric DEFAULT 0.0 NOT NULL,
    "is_percentage" boolean DEFAULT false,
    "percentage_value" numeric,
    "applicable_base" "text",
    "is_statutory" boolean DEFAULT false,
    "is_recurring" boolean DEFAULT true,
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "end_date" "date",
    "applicable_to" "text" NOT NULL,
    "department_id" "uuid",
    "staff_id" "uuid",
    "status" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "payroll_deductions_applicable_base_check" CHECK (("applicable_base" = ANY (ARRAY['basic'::"text", 'basic_allowances'::"text", 'gross'::"text"]))),
    CONSTRAINT "payroll_deductions_applicable_to_check" CHECK (("applicable_to" = ANY (ARRAY['all'::"text", 'department'::"text", 'individual'::"text"])))
);


ALTER TABLE "public"."payroll_deductions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_period_id" "uuid",
    "staff_id" "uuid",
    "school_id" "uuid",
    "basic_salary" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "gross_allowances" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "gross_deductions" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "paye_tax" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "ssnit_tier1" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "ssnit_tier2" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "loan_deductions" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "other_deductions" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "gross_pay" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "net_pay" numeric(15,2) DEFAULT 0.0 NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status",
    "payment_method" "text",
    "payment_reference" "text",
    "payment_date" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "payslip_generated" boolean DEFAULT false,
    "payslip_generated_at" timestamp with time zone,
    "payslip_accessed_at" timestamp with time zone,
    "payslip_downloaded" boolean DEFAULT false,
    "payslip_email_sent" boolean DEFAULT false,
    "payslip_email_sent_at" timestamp with time zone,
    "payment_notes" "text",
    "attendance_days" integer DEFAULT 0,
    "total_days_in_period" integer DEFAULT 0,
    CONSTRAINT "payroll_entries_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['bank_transfer'::"text", 'mobile_money'::"text", 'cash'::"text"])))
);


ALTER TABLE "public"."payroll_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "period_name" "text" NOT NULL,
    "period_type" "public"."payroll_period_type" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "public"."payroll_period_status" DEFAULT 'draft'::"public"."payroll_period_status",
    "processed_by" "uuid",
    "processed_at" timestamp with time zone,
    "total_gross_pay" numeric(15,2) DEFAULT 0.0,
    "total_net_pay" numeric(15,2) DEFAULT 0.0,
    "total_deductions" numeric(15,2) DEFAULT 0.0,
    "session_id" "uuid",
    "term_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "finalized_at" timestamp with time zone,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "closed_by" "uuid",
    "closed_at" timestamp with time zone,
    CONSTRAINT "valid_dates" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."payroll_periods" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payroll_periods"."status" IS 'Payroll period status - valid values: draft, processed, approved, closed';



COMMENT ON COLUMN "public"."payroll_periods"."finalized_at" IS 'Timestamp when the payroll period was finalized';



COMMENT ON COLUMN "public"."payroll_periods"."approved_by" IS 'User who approved the payroll period';



COMMENT ON COLUMN "public"."payroll_periods"."approved_at" IS 'Timestamp when the payroll period was approved';



COMMENT ON COLUMN "public"."payroll_periods"."closed_by" IS 'User who closed the payroll period';



COMMENT ON COLUMN "public"."payroll_periods"."closed_at" IS 'Timestamp when the payroll period was closed';



CREATE TABLE IF NOT EXISTS "public"."payslips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_entry_id" "uuid",
    "staff_id" "uuid",
    "school_id" "uuid",
    "document_url" "text",
    "generated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payslips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "status" "public"."permission_request_status" DEFAULT 'pending'::"public"."permission_request_status" NOT NULL,
    "justification" "text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_notes" "text",
    "school_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permission_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "permission_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module" "text" NOT NULL,
    "operation" "public"."crud_operation" NOT NULL,
    "resource" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."policy_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_type" "text" NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "assigned_to_type" "text" NOT NULL,
    "assigned_to_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "policy_assignments_assigned_to_type_check" CHECK (("assigned_to_type" = ANY (ARRAY['department'::"text", 'class'::"text", 'group'::"text"]))),
    CONSTRAINT "policy_assignments_policy_type_check" CHECK (("policy_type" = ANY (ARRAY['grading'::"text", 'assessment'::"text"])))
);


ALTER TABLE "public"."policy_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "custom_permissions_enabled" boolean DEFAULT false,
    "temp_password" "text",
    "school_id" "uuid",
    "title" "text",
    "first_name" "text",
    "middle_name" "text",
    "last_name" "text",
    "sex" "text",
    "date_of_birth" "date",
    "marital_status" "text",
    "number_of_children" integer DEFAULT 0,
    "national_id_type" "text",
    "national_id_number" "text",
    "residential_address" "text",
    "mobile_number" "text",
    "secondary_mobile" "text",
    "staff_photo_url" "text",
    "next_of_kin_name" "text",
    "next_of_kin_relationship" "text",
    "next_of_kin_phone" "text",
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "quick_links" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."quick_links" IS 'User-specific quick links stored as JSON array';



CREATE TABLE IF NOT EXISTS "public"."promotion_logs" (
    "id" bigint NOT NULL,
    "student_id" "uuid",
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."promotion_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."promotion_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."promotion_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."promotion_logs_id_seq" OWNED BY "public"."promotion_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."school_content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "slug" "text",
    "title" "text" NOT NULL,
    "content" "jsonb",
    "is_published" boolean DEFAULT false NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."school_content" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schools" (
    "school_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "address" "text",
    "phone" "text",
    "email" "text",
    "website" "text",
    "logo_url" "text",
    "principal_name" "text",
    "established_date" "date",
    "school_type" "text" DEFAULT 'primary'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "location_description" "text",
    "country" "text",
    "theme_color" "text"
);


ALTER TABLE "public"."schools" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schools"."settings" IS 'JSONB field containing school configuration including subscription data: { "subscription": { "tier": "basic"|"pro"|"advanced", "enabled_modules": ["module1", "module2"], "custom_modules": [], "subscription_date": "ISO date", "expiry_date": "ISO date" } }';



COMMENT ON COLUMN "public"."schools"."latitude" IS 'Latitude coordinate of the school location';



COMMENT ON COLUMN "public"."schools"."longitude" IS 'Longitude coordinate of the school location';



COMMENT ON COLUMN "public"."schools"."location_description" IS 'User-friendly description of the school location';



CREATE TABLE IF NOT EXISTS "public"."session_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "notes" "text",
    "marked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "marked_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text", 'excused'::"text"])))
);


ALTER TABLE "public"."session_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "employee_id" "text",
    "hire_date" "date",
    "job_description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department_id" "uuid",
    "position_id" "uuid",
    "salary" numeric(15,2),
    "phone" "text",
    "address" "text",
    "emergency_contact" "text",
    "contract_type" "text" DEFAULT 'full_time'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "school_id" "uuid",
    "role_specific_data" "jsonb" DEFAULT '{}'::"jsonb",
    "job_title" "text",
    "staff_category" "text",
    "qualification" "text",
    "basic_salary_gross" numeric,
    "payment_mode" "text" DEFAULT 'bank_transfer'::"text",
    "bank_name" "text",
    "bank_account_number" "text",
    "bank_branch" "text",
    "ssnit_contributor" boolean DEFAULT false,
    "ssnit_number" "text",
    "tin_number" "text",
    CONSTRAINT "staff_contract_type_check" CHECK (("contract_type" = ANY (ARRAY['full_time'::"text", 'part_time'::"text", 'contract'::"text", 'intern'::"text"]))),
    CONSTRAINT "staff_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'terminated'::"text", 'on_leave'::"text"])))
);


ALTER TABLE "public"."staff" OWNER TO "postgres";


COMMENT ON COLUMN "public"."staff"."role_specific_data" IS 'JSON field for role-specific data. For drivers: license_number, license_expiry_date, license_class, residential_address, assigned_vehicle_id, assigned_route_id, experience_years, medical_certificate_expiry, etc.';



CREATE TABLE IF NOT EXISTS "public"."staff_assignments" (
    "assignment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "assignment_type" "text" NOT NULL,
    "class_id" "uuid",
    "subject_id" "uuid",
    "department_id" "uuid",
    "description" "text",
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_assignments_assignment_type_check" CHECK (("assignment_type" = ANY (ARRAY['class'::"text", 'subject'::"text", 'department'::"text", 'administrative'::"text"])))
);


ALTER TABLE "public"."staff_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."statutory_record_details" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "statutory_record_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "employee_name" "text" NOT NULL,
    "employee_id" "text",
    "ssnit_number" "text",
    "tin_number" "text",
    "employee_amount" numeric DEFAULT 0.0 NOT NULL,
    "employer_amount" numeric DEFAULT 0.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."statutory_record_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."statutory_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "payroll_period_id" "uuid" NOT NULL,
    "statutory_type" "text" NOT NULL,
    "total_employee_amount" numeric DEFAULT 0.0 NOT NULL,
    "total_employer_amount" numeric DEFAULT 0.0 NOT NULL,
    "payment_date" "date",
    "reference_number" "text",
    "proof_of_payment_url" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "submitted_by" "uuid",
    "submitted_at" timestamp with time zone,
    "acknowledged_by" "uuid",
    "acknowledged_at" timestamp with time zone,
    CONSTRAINT "statutory_records_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'submitted'::"text", 'acknowledged'::"text"]))),
    CONSTRAINT "statutory_records_statutory_type_check" CHECK (("statutory_type" = ANY (ARRAY['ssnit_tier1'::"text", 'ssnit_tier2'::"text", 'paye'::"text"])))
);


ALTER TABLE "public"."statutory_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."streams" (
    "stream_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid"
);


ALTER TABLE "public"."streams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "academic_year" "text" NOT NULL,
    "class_level" "text" NOT NULL,
    "section" "text",
    "grade_average" numeric(5,2),
    "behavioral_notes" "text",
    "achievements" "text"[],
    "disciplinary_actions" "text"[],
    "teacher_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."student_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_remark_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "description" "text" NOT NULL,
    "category" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "school_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "student_remark_templates_category_check" CHECK (("category" = ANY (ARRAY['attitude'::"text", 'conduct'::"text", 'temperament'::"text", 'class_teacher'::"text", 'head_teacher'::"text"])))
);


ALTER TABLE "public"."student_remark_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_remarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "template_id" "uuid",
    "remark_text" "text" NOT NULL,
    "category" "text" NOT NULL,
    "recorded_by" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "term_id" "uuid",
    "class_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "student_remarks_category_check" CHECK (("category" = ANY (ARRAY['attitude'::"text", 'conduct'::"text", 'temperament'::"text", 'class_teacher'::"text", 'head_teacher'::"text"])))
);


ALTER TABLE "public"."student_remarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "old_status" "text",
    "new_status" "text" NOT NULL,
    "reason" "text",
    "effective_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "changed_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "student_status_history_status_check" CHECK (("new_status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'graduated'::"text", 'transferred'::"text", 'promoted'::"text", 'suspended'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."student_status_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."student_status_history" IS 'Tracks all student status changes with audit trail';



COMMENT ON COLUMN "public"."student_status_history"."reason" IS 'Reason for status change (e.g., "End of Academic Year", "Disciplinary Action")';



COMMENT ON COLUMN "public"."student_status_history"."notes" IS 'Additional notes about the status change';



CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "date_of_birth" "date",
    "gender" "text",
    "class_level" "text",
    "section" "text",
    "admission_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "address" "text",
    "medical_conditions" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid",
    "session_id" "uuid",
    "term_id" "uuid",
    "class_id" "uuid",
    "enrollment_status" "text" DEFAULT 'enrolled'::"text" NOT NULL,
    "profile_picture_url" "text" DEFAULT 'https://your-supabase-url/storage/v1/object/public/avatars/default.png'::"text",
    CONSTRAINT "students_enrollment_status_check" CHECK (("enrollment_status" = ANY (ARRAY['enrolled'::"text", 'graduated'::"text", 'withdrawn'::"text", 'transferred'::"text", 'suspended'::"text"]))),
    CONSTRAINT "students_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'graduated'::"text"])))
);


ALTER TABLE "public"."students" OWNER TO "postgres";


COMMENT ON COLUMN "public"."students"."status" IS 'Student status: active (currently enrolled), inactive (not enrolled), graduated (completed terminal class)';



COMMENT ON COLUMN "public"."students"."profile_picture_url" IS 'URL to student profile picture in storage';



CREATE TABLE IF NOT EXISTS "public"."subjects" (
    "subject_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid",
    "department_id" "uuid",
    "subject_type" "text" DEFAULT 'core'::"text",
    "is_active" boolean DEFAULT true,
    CONSTRAINT "subjects_subject_type_check" CHECK (("subject_type" = ANY (ARRAY['core'::"text", 'elective'::"text"])))
);


ALTER TABLE "public"."subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subjects_departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subjects_departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_assignments" (
    "assignment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "teacher_id" "uuid",
    "is_class_teacher" boolean DEFAULT false,
    "academic_year_id" "uuid",
    "start_date" "date" DEFAULT CURRENT_DATE,
    "end_date" "date",
    "status" "text" DEFAULT 'active'::"text",
    "assignment_type" "text" DEFAULT 'subject_teacher'::"text",
    "subclass_id" "uuid",
    "term_id" "uuid",
    "school_id" "uuid",
    CONSTRAINT "teacher_assignments_assignment_type_check" CHECK (("assignment_type" = ANY (ARRAY['class_teacher'::"text", 'subject_teacher'::"text"]))),
    CONSTRAINT "teacher_assignments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."teacher_assignments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."teacher_assignments"."school_id" IS 'School ID for the teacher assignment';



CREATE TABLE IF NOT EXISTS "public"."teachers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "employee_id" "text",
    "subjects_taught" "text"[],
    "hire_date" "date",
    "qualification" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid",
    "department_id" "uuid"
);


ALTER TABLE "public"."teachers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."teachers"."user_id" IS 'References auth.users.id via profiles.user_id';



CREATE TABLE IF NOT EXISTS "public"."terms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sequence_order" integer,
    CONSTRAINT "terms_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."terms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."terms"."sequence_order" IS 'Sequential order of terms within a session (e.g., 1 for Term 1, 2 for Term 2, 3 for Term 3). Used for automatic term progression.';



CREATE TABLE IF NOT EXISTS "public"."timetable_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "timetable_id" "uuid",
    "class_id" "uuid",
    "subject_id" "uuid",
    "teacher_id" "uuid",
    "room_id" "uuid",
    "day_of_week" integer NOT NULL,
    "period_id" "uuid",
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "status" character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "timetable_entries_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['scheduled'::character varying, 'cancelled'::character varying, 'rescheduled'::character varying])::"text"[])))
);


ALTER TABLE "public"."timetable_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "name" character varying(100) NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "period_order" integer NOT NULL,
    "is_break" boolean DEFAULT false,
    "break_duration" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."timetable_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "name" character varying(100) NOT NULL,
    "room_type" character varying(50) NOT NULL,
    "capacity" integer,
    "location" character varying(255),
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "timetable_rooms_room_type_check" CHECK ((("room_type")::"text" = ANY ((ARRAY['classroom'::character varying, 'lab'::character varying, 'ict'::character varying, 'music'::character varying, 'sports'::character varying, 'library'::character varying, 'other'::character varying])::"text"[])))
);


ALTER TABLE "public"."timetable_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_subject_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid",
    "subject_id" "uuid",
    "required_periods" integer DEFAULT 1 NOT NULL,
    "preferred_teachers" "uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."timetable_subject_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_teacher_absences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "timetable_id" "uuid",
    "teacher_id" "uuid",
    "date" "date" NOT NULL,
    "period_id" "uuid",
    "reason" "text",
    "replacement_teacher_id" "uuid",
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "timetable_teacher_absences_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'completed'::character varying])::"text"[])))
);


ALTER TABLE "public"."timetable_teacher_absences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_teacher_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid",
    "school_id" "uuid",
    "day_of_week" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_available" boolean DEFAULT true,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."timetable_teacher_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "name" character varying(100) NOT NULL,
    "description" "text",
    "days_of_week" integer[] NOT NULL,
    "periods_per_day" integer NOT NULL,
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."timetable_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "template_id" "uuid",
    "name" character varying(100) NOT NULL,
    "academic_year" character varying(20),
    "term_id" "uuid",
    "status" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "generated_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "timetables_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::"text"[])))
);


ALTER TABLE "public"."timetables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tip_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tip_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "school_id" "uuid",
    "user_role" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tip_analytics_event_type_check" CHECK (("event_type" = ANY (ARRAY['shown'::"text", 'dismissed'::"text", 'action_clicked'::"text", 'helpful'::"text", 'not_helpful'::"text"])))
);


ALTER TABLE "public"."tip_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_billing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "assignment_id" "uuid",
    "billing_month" "date" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_billing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_billing_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "amount" numeric NOT NULL,
    "amount_paid" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "billing_cycle" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "description" "text",
    "payment_method" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_billing_invoices_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'annual'::"text"]))),
    CONSTRAINT "transport_billing_invoices_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."transport_billing_invoices" OWNER TO "postgres";


COMMENT ON TABLE "public"."transport_billing_invoices" IS 'Stores transport billing invoices for students';



CREATE TABLE IF NOT EXISTS "public"."transport_billing_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "payment_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "payment_method" "text" NOT NULL,
    "transaction_id" "text",
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_billing_payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."transport_billing_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."transport_billing_payments" IS 'Stores transport billing payments made by students';



CREATE TABLE IF NOT EXISTS "public"."transport_billing_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "route_type" "text" NOT NULL,
    "distance_range_min" numeric,
    "distance_range_max" numeric,
    "rate_per_km" numeric,
    "base_rate" numeric DEFAULT 0 NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_billing_rates_route_type_check" CHECK (("route_type" = ANY (ARRAY['pickup'::"text", 'dropoff'::"text"])))
);


ALTER TABLE "public"."transport_billing_rates" OWNER TO "postgres";


COMMENT ON TABLE "public"."transport_billing_rates" IS 'Stores transport billing rate configurations';



CREATE TABLE IF NOT EXISTS "public"."transport_bus_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "route_id" "uuid" NOT NULL,
    "academic_year" "text" NOT NULL,
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "effective_to" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_bus_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_driver_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "end_date" "date",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_driver_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_routes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_point" "text",
    "end_point" "text",
    "distance_km" numeric,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "route_type" character varying(10) NOT NULL,
    "vehicle_id" "uuid",
    "driver_id" "uuid",
    CONSTRAINT "transport_routes_route_type_check" CHECK ((("route_type")::"text" = ANY ((ARRAY['pickup'::character varying, 'dropoff'::character varying])::"text"[])))
);


ALTER TABLE "public"."transport_routes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transport_routes"."route_type" IS 'Type of route: pickup (morning) or dropoff (afternoon)';



COMMENT ON COLUMN "public"."transport_routes"."vehicle_id" IS 'Vehicle assigned to this route';



COMMENT ON COLUMN "public"."transport_routes"."driver_id" IS 'Driver assigned to this route';



CREATE TABLE IF NOT EXISTS "public"."transport_stops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "route_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "latitude" numeric(9,6),
    "longitude" numeric(9,6),
    "sequence" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_stops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_student_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "route_id" "uuid",
    "pickup_stop_id" "uuid",
    "dropoff_stop_id" "uuid",
    "vehicle_id" "uuid",
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "effective_to" "date",
    "billing_amount" numeric,
    "billing_cycle" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "billing_enabled" boolean DEFAULT true,
    "drop_off_location" "text",
    "pickup_location" "text",
    "pickup_contact_name" "text",
    "pickup_contact_phone" "text",
    "pickup_contact_relationship" "text",
    "dropoff_contact_name" "text",
    "dropoff_contact_phone" "text",
    "dropoff_contact_relationship" "text",
    "pickup_description" "text",
    "dropoff_description" "text",
    "pickup_latitude" double precision,
    "pickup_longitude" double precision,
    "dropoff_latitude" double precision,
    "dropoff_longitude" double precision,
    "pickup_route_id" "uuid",
    "dropoff_route_id" "uuid",
    CONSTRAINT "chk_route_specified" CHECK ((("route_id" IS NOT NULL) OR (("pickup_route_id" IS NOT NULL) OR ("dropoff_route_id" IS NOT NULL))))
);


ALTER TABLE "public"."transport_student_assignments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_contact_name" IS 'Name of person responsible for pickup';



COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_contact_phone" IS 'Phone number of person responsible for pickup';



COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_contact_relationship" IS 'Relationship of pickup contact to student';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_contact_name" IS 'Name of person responsible for dropoff';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_contact_phone" IS 'Phone number of person responsible for dropoff';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_contact_relationship" IS 'Relationship of dropoff contact to student';



COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_description" IS 'User-friendly description of pickup location';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_description" IS 'User-friendly description of dropoff location';



COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_latitude" IS 'Latitude coordinate of pickup location';



COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_longitude" IS 'Longitude coordinate of pickup location';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_latitude" IS 'Latitude coordinate of dropoff location';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_longitude" IS 'Longitude coordinate of dropoff location';



COMMENT ON COLUMN "public"."transport_student_assignments"."pickup_route_id" IS 'Route used for pickup';



COMMENT ON COLUMN "public"."transport_student_assignments"."dropoff_route_id" IS 'Route used for dropoff';



CREATE TABLE IF NOT EXISTS "public"."transport_vehicle_assistant_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "assistant_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_vehicle_assistant_assignments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."transport_vehicle_assistant_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."transport_vehicle_assistant_assignments" IS 'Table to track vehicle assistant assignments to vehicles';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."id" IS 'Unique identifier for the assignment';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."school_id" IS 'School that owns this assignment';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."vehicle_id" IS 'Vehicle that the assistant is assigned to';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."assistant_id" IS 'Staff member with vehicle assistant role assigned to the vehicle';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."assigned_at" IS 'Timestamp when the assistant was assigned to the vehicle';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."assigned_by" IS 'User who made the assignment';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."status" IS 'Status of the assignment (active/inactive)';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."created_at" IS 'Timestamp when the record was created';



COMMENT ON COLUMN "public"."transport_vehicle_assistant_assignments"."updated_at" IS 'Timestamp when the record was last updated';



CREATE TABLE IF NOT EXISTS "public"."transport_vehicle_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "credential_type" "text" NOT NULL,
    "document_number" "text" NOT NULL,
    "issue_date" "date" NOT NULL,
    "expiry_date" "date" NOT NULL,
    "status" "text" DEFAULT 'valid'::"text" NOT NULL,
    "notes" "text",
    "created_at" "date" DEFAULT CURRENT_DATE,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "transport_vehicle_credentials_status_check" CHECK (("status" = ANY (ARRAY['valid'::"text", 'expiring'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."transport_vehicle_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "registration_number" "text" NOT NULL,
    "capacity" integer,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "model" "text",
    "bus_name" character varying(255),
    "tank_capacity_liters" numeric(8,2),
    "fuel_type" character varying(50),
    "operational_status" character varying(50) DEFAULT 'Available'::character varying,
    "last_maintenance_date" "date",
    "system_status" character varying(20) DEFAULT 'Active'::character varying,
    CONSTRAINT "transport_vehicles_fuel_type_check" CHECK ((("fuel_type")::"text" = ANY ((ARRAY['Diesel'::character varying, 'Petrol'::character varying, 'CNG'::character varying, 'Electric'::character varying])::"text"[]))),
    CONSTRAINT "transport_vehicles_operational_status_check" CHECK ((("operational_status")::"text" = ANY ((ARRAY['Available'::character varying, 'On Trip'::character varying, 'Under Maintenance'::character varying])::"text"[]))),
    CONSTRAINT "transport_vehicles_system_status_check" CHECK ((("system_status")::"text" = ANY ((ARRAY['Active'::character varying, 'Inactive'::character varying])::"text"[])))
);


ALTER TABLE "public"."transport_vehicles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transport_vehicles"."registration_number" IS 'Official license plate number (required)';



COMMENT ON COLUMN "public"."transport_vehicles"."capacity" IS 'Number of seats available';



COMMENT ON COLUMN "public"."transport_vehicles"."model" IS 'Make and model of the bus (e.g., "Toyota Coaster")';



COMMENT ON COLUMN "public"."transport_vehicles"."bus_name" IS 'Optional friendly name for the bus (e.g., "The Yellow Submarine")';



COMMENT ON COLUMN "public"."transport_vehicles"."tank_capacity_liters" IS 'Fuel tank size in liters';



COMMENT ON COLUMN "public"."transport_vehicles"."fuel_type" IS 'Type of fuel: Diesel, Petrol, CNG, or Electric';



COMMENT ON COLUMN "public"."transport_vehicles"."operational_status" IS 'Current operational state: Available, On Trip, Under Maintenance';



COMMENT ON COLUMN "public"."transport_vehicles"."last_maintenance_date" IS 'Date of last service/maintenance';



COMMENT ON COLUMN "public"."transport_vehicles"."system_status" IS 'System status: Active or Inactive';



CREATE TABLE IF NOT EXISTS "public"."user_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "is_all_day" boolean DEFAULT false,
    "location" "text",
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permissions" (
    "user_permission_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "granted_by" "uuid",
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."user_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permissions_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permission_id" "uuid",
    "action" "text" NOT NULL,
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "permission_details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_permissions_audit_action_check" CHECK (("action" = ANY (ARRAY['granted'::"text", 'revoked'::"text", 'bulk_granted'::"text", 'bulk_revoked'::"text", 'expired'::"text", 'template_applied'::"text"])))
);


ALTER TABLE "public"."user_permissions_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_push_tokens" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "device_platform" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_push_tokens" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_push_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_push_tokens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_push_tokens_id_seq" OWNED BY "public"."user_push_tokens"."id";



CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_tips_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tip_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "dismissed_at" timestamp with time zone,
    "remind_at" timestamp with time zone,
    "view_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "daily_view_count" integer DEFAULT 0,
    "last_view_date" "date",
    CONSTRAINT "user_tips_state_status_check" CHECK (("status" = ANY (ARRAY['seen'::"text", 'dismissed'::"text", 'remind_later'::"text"])))
);


ALTER TABLE "public"."user_tips_state" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_academic_structure" AS
 SELECT "d"."department_id",
    "d"."name" AS "department_name",
    "d"."school_id",
    "c1"."class_id" AS "umbrella_class_id",
    "c1"."name" AS "umbrella_class_name",
    "c2"."class_id" AS "subclass_id",
    "c2"."name" AS "umbrella_class_name_with_subclass",
    "c2"."sub_class" AS "subclass_name",
    "cta"."teacher_id" AS "class_teacher_id",
    "p"."full_name" AS "class_teacher_name"
   FROM ((((("public"."departments" "d"
     LEFT JOIN "public"."classes" "c1" ON ((("d"."department_id" = "c1"."department_id") AND (("c1"."class_type" = 'umbrella'::"text") OR ("c1"."class_type" IS NULL)))))
     LEFT JOIN "public"."classes" "c2" ON ((("c1"."class_id" = "c2"."parent_class_id") AND ("c2"."class_type" = 'subclass'::"text"))))
     LEFT JOIN "public"."class_teacher_assignments" "cta" ON ((("c2"."class_id" = "cta"."class_id") AND ("cta"."is_active" = true))))
     LEFT JOIN "public"."teachers" "ct" ON (("cta"."teacher_id" = "ct"."id")))
     LEFT JOIN "public"."profiles" "p" ON (("ct"."user_id" = "p"."id")))
  ORDER BY "d"."name", "c1"."name", "c2"."sub_class";


ALTER VIEW "public"."vw_academic_structure" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_vehicle_assistants" AS
 SELECT "ur"."user_id",
    "ur"."role",
    "p"."full_name",
    "p"."first_name",
    "p"."middle_name",
    "p"."last_name",
    "p"."email",
    "p"."mobile_number",
    "p"."residential_address",
    "p"."date_of_birth",
    "p"."sex",
    "s"."id" AS "staff_id",
    "s"."employee_id",
    "s"."hire_date",
    "s"."job_title",
    "s"."status" AS "staff_status",
    "s"."school_id",
    "sch"."name" AS "school_name"
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."profiles" "p" ON (("ur"."user_id" = "p"."user_id")))
     JOIN "public"."staff" "s" ON (("ur"."user_id" = "s"."user_id")))
     JOIN "public"."schools" "sch" ON (("s"."school_id" = "sch"."school_id")))
  WHERE (("ur"."role" = 'vehicle_assistant'::"public"."app_role") AND ("s"."status" = 'active'::"text"));


ALTER VIEW "public"."vw_vehicle_assistants" OWNER TO "postgres";


ALTER TABLE ONLY "public"."promotion_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."promotion_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_push_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_push_tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."academic_sessions"
    ADD CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."academic_sessions"
    ADD CONSTRAINT "academic_sessions_school_id_name_key" UNIQUE ("school_id", "name");



ALTER TABLE ONLY "public"."adjustments"
    ADD CONSTRAINT "adjustments_adjustment_number_key" UNIQUE ("adjustment_number");



ALTER TABLE ONLY "public"."adjustments"
    ADD CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_publications"
    ADD CONSTRAINT "assessment_publications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_types"
    ADD CONSTRAINT "assessment_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_categories"
    ADD CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_categories"
    ADD CONSTRAINT "asset_categories_school_id_name_key" UNIQUE ("school_id", "name");



ALTER TABLE ONLY "public"."asset_depreciation"
    ADD CONSTRAINT "asset_depreciation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_maintenance"
    ADD CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_movements"
    ADD CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("asset_id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_sku_key" UNIQUE ("sku");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_bill_number_key" UNIQUE ("bill_number");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."borrowing_transactions"
    ADD CONSTRAINT "borrowing_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."class_subjects"
    ADD CONSTRAINT "class_subjects_class_id_subject_id_key" UNIQUE ("class_id", "subject_id");



ALTER TABLE ONLY "public"."class_subjects"
    ADD CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("class_subject_id");



ALTER TABLE ONLY "public"."class_teacher_assignments"
    ADD CONSTRAINT "class_teacher_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("class_id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("department_id");



ALTER TABLE ONLY "public"."driver_ride_history"
    ADD CONSTRAINT "driver_ride_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_school_id_license_number_key" UNIQUE ("school_id", "license_number");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_school_id_user_id_key" UNIQUE ("school_id", "user_id");



ALTER TABLE ONLY "public"."emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_student_id_academic_year_key" UNIQUE ("student_id", "academic_year");



ALTER TABLE ONLY "public"."event_recipients"
    ADD CONSTRAINT "event_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_results"
    ADD CONSTRAINT "exam_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exams"
    ADD CONSTRAINT "exams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fee_accounts"
    ADD CONSTRAINT "fee_accounts_account_number_key" UNIQUE ("account_number");



ALTER TABLE ONLY "public"."fee_accounts"
    ADD CONSTRAINT "fee_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fee_transactions"
    ADD CONSTRAINT "fee_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fixed_assets"
    ADD CONSTRAINT "fixed_assets_asset_id_key" UNIQUE ("asset_id");



ALTER TABLE ONLY "public"."fixed_assets"
    ADD CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grading_policies"
    ADD CONSTRAINT "grading_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grading_policy_grades"
    ADD CONSTRAINT "grading_policy_grades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_user_id_key" UNIQUE ("group_id", "user_id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_message_permissions"
    ADD CONSTRAINT "group_message_permissions_group_id_user_id_key" UNIQUE ("group_id", "user_id");



ALTER TABLE ONLY "public"."group_message_permissions"
    ADD CONSTRAINT "group_message_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_reads"
    ADD CONSTRAINT "group_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_reads"
    ADD CONSTRAINT "group_reads_user_id_group_id_key" UNIQUE ("user_id", "group_id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_borrowing_transactions"
    ADD CONSTRAINT "inventory_borrowing_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_item_code_key" UNIQUE ("item_code");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."library_books"
    ADD CONSTRAINT "library_books_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."library_categories"
    ADD CONSTRAINT "library_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."library_transactions"
    ADD CONSTRAINT "library_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_logs"
    ADD CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_school_id_key" UNIQUE ("user_id", "school_id");



ALTER TABLE ONLY "public"."parent_student_links"
    ADD CONSTRAINT "parent_student_links_parent_user_id_student_id_key" UNIQUE ("parent_user_id", "student_id");



ALTER TABLE ONLY "public"."parent_student_links"
    ADD CONSTRAINT "parent_student_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parent_student_links"
    ADD CONSTRAINT "parent_student_links_unique_link" UNIQUE ("student_id", "parent_user_id");



ALTER TABLE ONLY "public"."parents"
    ADD CONSTRAINT "parents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parents"
    ADD CONSTRAINT "parents_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_batch_reference_key" UNIQUE ("batch_reference");



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_plans"
    ADD CONSTRAINT "payment_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_transaction_reference_key" UNIQUE ("transaction_reference");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_payment_number_key" UNIQUE ("payment_number");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_allowances"
    ADD CONSTRAINT "payroll_allowances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_component_audit_log"
    ADD CONSTRAINT "payroll_component_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_deductions"
    ADD CONSTRAINT "payroll_deductions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_period_staff_unique" UNIQUE ("payroll_period_id", "staff_id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_requests"
    ADD CONSTRAINT "permission_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_requests"
    ADD CONSTRAINT "permission_requests_user_id_permission_id_status_key" UNIQUE ("user_id", "permission_id", "status");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_module_operation_resource_key" UNIQUE ("module", "operation", "resource");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id");



ALTER TABLE ONLY "public"."policy_assignments"
    ADD CONSTRAINT "policy_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."promotion_logs"
    ADD CONSTRAINT "promotion_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."school_content"
    ADD CONSTRAINT "school_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schools"
    ADD CONSTRAINT "schools_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."schools"
    ADD CONSTRAINT "schools_pkey" PRIMARY KEY ("school_id");



ALTER TABLE ONLY "public"."session_attendance"
    ADD CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("assignment_id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_employee_id_key" UNIQUE ("employee_id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."statutory_record_details"
    ADD CONSTRAINT "statutory_record_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."statutory_records"
    ADD CONSTRAINT "statutory_records_period_type_unique" UNIQUE ("payroll_period_id", "statutory_type");



ALTER TABLE ONLY "public"."statutory_records"
    ADD CONSTRAINT "statutory_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."streams"
    ADD CONSTRAINT "streams_pkey" PRIMARY KEY ("stream_id");



ALTER TABLE ONLY "public"."student_history"
    ADD CONSTRAINT "student_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_remark_templates"
    ADD CONSTRAINT "student_remark_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_status_history"
    ADD CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_student_id_key" UNIQUE ("student_id");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."subjects_departments"
    ADD CONSTRAINT "subjects_departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subjects_departments"
    ADD CONSTRAINT "subjects_departments_subject_id_department_id_key" UNIQUE ("subject_id", "department_id");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_pkey" PRIMARY KEY ("subject_id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("assignment_id");



ALTER TABLE ONLY "public"."teachers"
    ADD CONSTRAINT "teachers_employee_id_key" UNIQUE ("employee_id");



ALTER TABLE ONLY "public"."teachers"
    ADD CONSTRAINT "teachers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teachers"
    ADD CONSTRAINT "teachers_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."terms"
    ADD CONSTRAINT "terms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."terms"
    ADD CONSTRAINT "terms_session_id_name_key" UNIQUE ("session_id", "name");



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_periods"
    ADD CONSTRAINT "timetable_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_rooms"
    ADD CONSTRAINT "timetable_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_subject_requirements"
    ADD CONSTRAINT "timetable_subject_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_teacher_absences"
    ADD CONSTRAINT "timetable_teacher_absences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_teacher_availability"
    ADD CONSTRAINT "timetable_teacher_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_templates"
    ADD CONSTRAINT "timetable_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetables"
    ADD CONSTRAINT "timetables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tip_analytics"
    ADD CONSTRAINT "tip_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_billing_invoices"
    ADD CONSTRAINT "transport_billing_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_billing_payments"
    ADD CONSTRAINT "transport_billing_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_billing"
    ADD CONSTRAINT "transport_billing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_billing_rates"
    ADD CONSTRAINT "transport_billing_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_bus_assignments"
    ADD CONSTRAINT "transport_bus_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_driver_assignments"
    ADD CONSTRAINT "transport_driver_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_routes"
    ADD CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_stops"
    ADD CONSTRAINT "transport_stops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_vehicle_assistant_assignments"
    ADD CONSTRAINT "transport_vehicle_assistant_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_vehicle_credentials"
    ADD CONSTRAINT "transport_vehicle_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_vehicles"
    ADD CONSTRAINT "transport_vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_attendance"
    ADD CONSTRAINT "unique_session_student_attendance" UNIQUE ("session_id", "student_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "unique_staff_attendance_per_date" UNIQUE ("school_id", "staff_id", "date");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "unique_staff_user_id" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "unique_student_attendance_per_date" UNIQUE ("school_id", "student_id", "date");



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "unique_student_category_session" UNIQUE ("student_id", "category", "session_id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permissions_audit"
    ADD CONSTRAINT "user_permissions_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_permission_id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_user_id_permission_id_key" UNIQUE ("user_id", "permission_id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_user_id_school_id_token_key" UNIQUE ("user_id", "school_id", "token");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."user_tips_state"
    ADD CONSTRAINT "user_tips_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_tips_state"
    ADD CONSTRAINT "user_tips_state_user_id_tip_id_key" UNIQUE ("user_id", "tip_id");



CREATE UNIQUE INDEX "academic_sessions_school_current_unique" ON "public"."academic_sessions" USING "btree" ("school_id") WHERE ("is_current" = true);



CREATE INDEX "idx_adjustments_adjustment_type" ON "public"."adjustments" USING "btree" ("adjustment_type");



CREATE INDEX "idx_adjustments_bill_id" ON "public"."adjustments" USING "btree" ("bill_id");



CREATE INDEX "idx_adjustments_school_id" ON "public"."adjustments" USING "btree" ("school_id");



CREATE INDEX "idx_adjustments_status" ON "public"."adjustments" USING "btree" ("status");



CREATE INDEX "idx_adjustments_student_id" ON "public"."adjustments" USING "btree" ("student_id");



CREATE INDEX "idx_adjustments_transaction_type" ON "public"."adjustments" USING "btree" ("transaction_type");



CREATE INDEX "idx_assessment_publications_school_id" ON "public"."assessment_publications" USING "btree" ("school_id");



CREATE INDEX "idx_assessment_publications_session_id" ON "public"."assessment_publications" USING "btree" ("session_id");



CREATE INDEX "idx_assessment_publications_status" ON "public"."assessment_publications" USING "btree" ("status");



CREATE INDEX "idx_assessment_publications_term_id" ON "public"."assessment_publications" USING "btree" ("term_id");



CREATE INDEX "idx_assessment_results_class_id" ON "public"."assessment_results" USING "btree" ("class_id");



CREATE INDEX "idx_assessment_results_school_id" ON "public"."assessment_results" USING "btree" ("school_id");



CREATE INDEX "idx_assessment_results_session_id" ON "public"."assessment_results" USING "btree" ("session_id");



CREATE INDEX "idx_assessment_results_student_id" ON "public"."assessment_results" USING "btree" ("student_id");



CREATE INDEX "idx_assessment_results_subject_id" ON "public"."assessment_results" USING "btree" ("subject_id");



CREATE INDEX "idx_assessment_results_term_id" ON "public"."assessment_results" USING "btree" ("term_id");



CREATE INDEX "idx_assessment_types_applies_to" ON "public"."assessment_types" USING "btree" ("applies_to");



CREATE INDEX "idx_assessment_types_grading_policy_id" ON "public"."assessment_types" USING "btree" ("grading_policy_id");



CREATE INDEX "idx_assessment_types_max_marks" ON "public"."assessment_types" USING "btree" ("max_marks");



CREATE INDEX "idx_assessment_types_school_id" ON "public"."assessment_types" USING "btree" ("school_id");



CREATE INDEX "idx_assessment_types_status" ON "public"."assessment_types" USING "btree" ("status");



CREATE INDEX "idx_asset_assignments_asset_id" ON "public"."asset_assignments" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_categories_school_id" ON "public"."asset_categories" USING "btree" ("school_id");



CREATE INDEX "idx_asset_depreciation_asset_id" ON "public"."asset_depreciation" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_maintenance_asset_id" ON "public"."asset_maintenance" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_movements_asset_id" ON "public"."asset_movements" USING "btree" ("asset_id");



CREATE INDEX "idx_assets_added_by_staff_id" ON "public"."assets" USING "btree" ("added_by_staff_id");



CREATE INDEX "idx_assets_category" ON "public"."assets" USING "btree" ("category");



CREATE INDEX "idx_assets_is_active" ON "public"."assets" USING "btree" ("is_active");



CREATE INDEX "idx_assets_school_id" ON "public"."assets" USING "btree" ("school_id");



CREATE INDEX "idx_assets_updated_by_staff_id" ON "public"."assets" USING "btree" ("updated_by_staff_id");



CREATE INDEX "idx_attendance_class_date" ON "public"."attendance" USING "btree" ("class_id", "date");



CREATE INDEX "idx_attendance_class_subject_date" ON "public"."attendance" USING "btree" ("class_id", "subject_id", "date");



CREATE INDEX "idx_attendance_school_date" ON "public"."attendance" USING "btree" ("school_id", "date");



CREATE INDEX "idx_attendance_sessions_school_date" ON "public"."attendance_sessions" USING "btree" ("school_id", "session_date");



CREATE INDEX "idx_attendance_staff_date" ON "public"."attendance" USING "btree" ("staff_id", "date");



CREATE INDEX "idx_attendance_student_date" ON "public"."attendance" USING "btree" ("student_id", "date");



CREATE INDEX "idx_bill_items_bill_id" ON "public"."bill_items" USING "btree" ("bill_id");



CREATE INDEX "idx_bills_class_id" ON "public"."bills" USING "btree" ("class_id");



CREATE INDEX "idx_bills_department_id" ON "public"."bills" USING "btree" ("department_id");



CREATE INDEX "idx_bills_due_date" ON "public"."bills" USING "btree" ("due_date");



CREATE INDEX "idx_bills_school_id" ON "public"."bills" USING "btree" ("school_id");



CREATE INDEX "idx_bills_session_id" ON "public"."bills" USING "btree" ("session_id");



CREATE INDEX "idx_bills_status" ON "public"."bills" USING "btree" ("status");



CREATE INDEX "idx_bills_student_id" ON "public"."bills" USING "btree" ("student_id");



CREATE INDEX "idx_bills_term_id" ON "public"."bills" USING "btree" ("term_id");



CREATE INDEX "idx_borrowing_transactions_asset_id" ON "public"."borrowing_transactions" USING "btree" ("asset_id");



CREATE INDEX "idx_borrowing_transactions_borrower_staff_id" ON "public"."borrowing_transactions" USING "btree" ("borrower_staff_id");



CREATE INDEX "idx_borrowing_transactions_school_id" ON "public"."borrowing_transactions" USING "btree" ("school_id");



CREATE INDEX "idx_borrowing_transactions_status" ON "public"."borrowing_transactions" USING "btree" ("status");



CREATE INDEX "idx_calendar_events_created_by" ON "public"."calendar_events" USING "btree" ("created_by");



CREATE INDEX "idx_calendar_events_end_time" ON "public"."calendar_events" USING "btree" ("end_time");



CREATE INDEX "idx_calendar_events_school_id" ON "public"."calendar_events" USING "btree" ("school_id");



CREATE INDEX "idx_calendar_events_start_time" ON "public"."calendar_events" USING "btree" ("start_time");



CREATE INDEX "idx_class_subjects_class_id" ON "public"."class_subjects" USING "btree" ("class_id");



CREATE INDEX "idx_class_subjects_subject_id" ON "public"."class_subjects" USING "btree" ("subject_id");



CREATE INDEX "idx_class_teacher_assignments_academic_year" ON "public"."class_teacher_assignments" USING "btree" ("academic_year_id");



CREATE INDEX "idx_class_teacher_assignments_active" ON "public"."class_teacher_assignments" USING "btree" ("is_active");



CREATE INDEX "idx_class_teacher_assignments_class_id" ON "public"."class_teacher_assignments" USING "btree" ("class_id");



CREATE INDEX "idx_class_teacher_assignments_teacher_id" ON "public"."class_teacher_assignments" USING "btree" ("teacher_id");



CREATE INDEX "idx_classes_class_teacher" ON "public"."classes" USING "btree" ("class_teacher_id");



CREATE INDEX "idx_classes_class_type" ON "public"."classes" USING "btree" ("class_type");



CREATE INDEX "idx_classes_is_subclass" ON "public"."classes" USING "btree" ("is_subclass");



CREATE INDEX "idx_classes_next_class" ON "public"."classes" USING "btree" ("next_class_id") WHERE ("next_class_id" IS NOT NULL);



CREATE INDEX "idx_classes_parent_class_id" ON "public"."classes" USING "btree" ("parent_class_id");



CREATE INDEX "idx_classes_school_id" ON "public"."classes" USING "btree" ("school_id");



CREATE INDEX "idx_classes_sequence_order" ON "public"."classes" USING "btree" ("department_id", "sequence_order") WHERE ("department_id" IS NOT NULL);



CREATE INDEX "idx_driver_ride_history_driver_id" ON "public"."driver_ride_history" USING "btree" ("driver_id");



CREATE INDEX "idx_driver_ride_history_ride_date" ON "public"."driver_ride_history" USING "btree" ("ride_date");



CREATE INDEX "idx_driver_ride_history_ride_status" ON "public"."driver_ride_history" USING "btree" ("ride_status");



CREATE INDEX "idx_driver_ride_history_school_id" ON "public"."driver_ride_history" USING "btree" ("school_id");



CREATE INDEX "idx_driver_ride_history_vehicle_id" ON "public"."driver_ride_history" USING "btree" ("vehicle_id");



CREATE INDEX "idx_drivers_assigned_bus_id" ON "public"."drivers" USING "btree" ("assigned_bus_id");



CREATE INDEX "idx_drivers_employment_status" ON "public"."drivers" USING "btree" ("employment_status");



CREATE INDEX "idx_drivers_profiles_user_id" ON "public"."drivers" USING "btree" ("user_id");



CREATE INDEX "idx_drivers_school_id" ON "public"."drivers" USING "btree" ("school_id");



CREATE INDEX "idx_drivers_staff_id" ON "public"."drivers" USING "btree" ("staff_id");



CREATE INDEX "idx_drivers_staff_user_id" ON "public"."drivers" USING "btree" ("user_id");



CREATE INDEX "idx_drivers_user_id" ON "public"."drivers" USING "btree" ("user_id");



CREATE INDEX "idx_emergency_contacts_email_lower" ON "public"."emergency_contacts" USING "btree" ("lower"("email"));



CREATE INDEX "idx_emergency_contacts_student_id" ON "public"."emergency_contacts" USING "btree" ("student_id");



CREATE INDEX "idx_enrollments_academic_year" ON "public"."enrollments" USING "btree" ("academic_year");



CREATE INDEX "idx_enrollments_class_id" ON "public"."enrollments" USING "btree" ("class_id");



CREATE INDEX "idx_enrollments_student_id" ON "public"."enrollments" USING "btree" ("student_id");



CREATE INDEX "idx_event_recipients_event_id" ON "public"."event_recipients" USING "btree" ("event_id");



CREATE INDEX "idx_event_recipients_recipient_id" ON "public"."event_recipients" USING "btree" ("recipient_id");



CREATE INDEX "idx_event_recipients_recipient_type" ON "public"."event_recipients" USING "btree" ("recipient_type");



CREATE INDEX "idx_fee_accounts_school" ON "public"."fee_accounts" USING "btree" ("school_id");



CREATE INDEX "idx_fee_accounts_student" ON "public"."fee_accounts" USING "btree" ("student_id");



CREATE INDEX "idx_fee_transactions_account" ON "public"."fee_transactions" USING "btree" ("account_id");



CREATE INDEX "idx_fee_transactions_school" ON "public"."fee_transactions" USING "btree" ("school_id");



CREATE INDEX "idx_fixed_assets_category" ON "public"."fixed_assets" USING "btree" ("category");



CREATE INDEX "idx_fixed_assets_school_id" ON "public"."fixed_assets" USING "btree" ("school_id");



CREATE INDEX "idx_fixed_assets_status" ON "public"."fixed_assets" USING "btree" ("status");



CREATE INDEX "idx_grading_policies_school_id" ON "public"."grading_policies" USING "btree" ("school_id");



CREATE INDEX "idx_grading_policies_scope" ON "public"."grading_policies" USING "btree" ("scope");



CREATE INDEX "idx_grading_policies_status" ON "public"."grading_policies" USING "btree" ("status");



CREATE INDEX "idx_grading_policy_grades_policy_id" ON "public"."grading_policy_grades" USING "btree" ("policy_id");



CREATE INDEX "idx_grading_policy_grades_sort_order" ON "public"."grading_policy_grades" USING "btree" ("sort_order");



CREATE INDEX "idx_inventory_borrowing_dates" ON "public"."inventory_borrowing_transactions" USING "btree" ("borrow_date", "expected_return_date");



CREATE INDEX "idx_inventory_borrowing_item_id" ON "public"."inventory_borrowing_transactions" USING "btree" ("item_id");



CREATE INDEX "idx_inventory_borrowing_school_id" ON "public"."inventory_borrowing_transactions" USING "btree" ("school_id");



CREATE INDEX "idx_inventory_borrowing_status" ON "public"."inventory_borrowing_transactions" USING "btree" ("status");



CREATE INDEX "idx_inventory_items_active" ON "public"."inventory_items" USING "btree" ("is_active");



CREATE INDEX "idx_inventory_items_category" ON "public"."inventory_items" USING "btree" ("category");



CREATE INDEX "idx_inventory_items_school_id" ON "public"."inventory_items" USING "btree" ("school_id");



CREATE INDEX "idx_inventory_items_stock_type" ON "public"."inventory_items" USING "btree" ("stock_type");



CREATE INDEX "idx_inventory_transactions_date" ON "public"."inventory_transactions" USING "btree" ("performed_at");



CREATE INDEX "idx_inventory_transactions_item_id" ON "public"."inventory_transactions" USING "btree" ("item_id");



CREATE INDEX "idx_inventory_transactions_school_id" ON "public"."inventory_transactions" USING "btree" ("school_id");



CREATE INDEX "idx_inventory_transactions_type" ON "public"."inventory_transactions" USING "btree" ("transaction_type");



CREATE INDEX "idx_library_books_school_id" ON "public"."library_books" USING "btree" ("school_id");



CREATE INDEX "idx_library_categories_school_id" ON "public"."library_categories" USING "btree" ("school_id");



CREATE INDEX "idx_library_transactions_book_id" ON "public"."library_transactions" USING "btree" ("book_id");



CREATE INDEX "idx_library_transactions_borrower_id" ON "public"."library_transactions" USING "btree" ("borrower_id");



CREATE INDEX "idx_library_transactions_school_id" ON "public"."library_transactions" USING "btree" ("school_id");



CREATE INDEX "idx_notification_logs_recipient" ON "public"."notification_logs" USING "btree" ("recipient_user_id");



CREATE INDEX "idx_notification_logs_sent_at" ON "public"."notification_logs" USING "btree" ("sent_at");



CREATE INDEX "idx_notification_logs_type" ON "public"."notification_logs" USING "btree" ("notification_type");



CREATE INDEX "idx_notification_prefs_user" ON "public"."notification_preferences" USING "btree" ("user_id");



CREATE INDEX "idx_parent_student_links_parent_user_id" ON "public"."parent_student_links" USING "btree" ("parent_user_id");



CREATE INDEX "idx_parent_student_links_student_id" ON "public"."parent_student_links" USING "btree" ("student_id");



CREATE INDEX "idx_payment_plans_bill_id" ON "public"."payment_plans" USING "btree" ("bill_id");



CREATE INDEX "idx_payment_plans_due_date" ON "public"."payment_plans" USING "btree" ("due_date");



CREATE INDEX "idx_payment_plans_school_id" ON "public"."payment_plans" USING "btree" ("school_id");



CREATE INDEX "idx_payment_plans_status" ON "public"."payment_plans" USING "btree" ("status");



CREATE INDEX "idx_payments_bill_id" ON "public"."payments" USING "btree" ("bill_id");



CREATE INDEX "idx_payments_payment_date" ON "public"."payments" USING "btree" ("payment_date");



CREATE INDEX "idx_payments_payment_method" ON "public"."payments" USING "btree" ("payment_method");



CREATE INDEX "idx_payments_school_id" ON "public"."payments" USING "btree" ("school_id");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_payments_student_id" ON "public"."payments" USING "btree" ("student_id");



CREATE INDEX "idx_payments_transaction_type" ON "public"."payments" USING "btree" ("transaction_type");



CREATE INDEX "idx_payroll_allowances_date_range" ON "public"."payroll_allowances" USING "btree" ("start_date", "end_date");



CREATE INDEX "idx_payroll_allowances_department_id" ON "public"."payroll_allowances" USING "btree" ("department_id");



CREATE INDEX "idx_payroll_allowances_recurring" ON "public"."payroll_allowances" USING "btree" ("is_recurring");



CREATE INDEX "idx_payroll_allowances_school_id" ON "public"."payroll_allowances" USING "btree" ("school_id");



CREATE INDEX "idx_payroll_allowances_staff_id" ON "public"."payroll_allowances" USING "btree" ("staff_id");



CREATE INDEX "idx_payroll_allowances_status" ON "public"."payroll_allowances" USING "btree" ("status");



CREATE INDEX "idx_payroll_component_audit_log_action" ON "public"."payroll_component_audit_log" USING "btree" ("action");



CREATE INDEX "idx_payroll_component_audit_log_component" ON "public"."payroll_component_audit_log" USING "btree" ("component_type", "component_id");



CREATE INDEX "idx_payroll_deductions_date_range" ON "public"."payroll_deductions" USING "btree" ("start_date", "end_date");



CREATE INDEX "idx_payroll_deductions_department_id" ON "public"."payroll_deductions" USING "btree" ("department_id");



CREATE INDEX "idx_payroll_deductions_recurring" ON "public"."payroll_deductions" USING "btree" ("is_recurring");



CREATE INDEX "idx_payroll_deductions_school_id" ON "public"."payroll_deductions" USING "btree" ("school_id");



CREATE INDEX "idx_payroll_deductions_staff_id" ON "public"."payroll_deductions" USING "btree" ("staff_id");



CREATE INDEX "idx_payroll_deductions_status" ON "public"."payroll_deductions" USING "btree" ("status");



CREATE INDEX "idx_payroll_entries_attendance_days" ON "public"."payroll_entries" USING "btree" ("attendance_days");



CREATE INDEX "idx_payroll_entries_payment_status" ON "public"."payroll_entries" USING "btree" ("payment_status");



CREATE INDEX "idx_payroll_entries_payslip_generated" ON "public"."payroll_entries" USING "btree" ("payslip_generated");



CREATE INDEX "idx_payroll_entries_period" ON "public"."payroll_entries" USING "btree" ("payroll_period_id");



CREATE INDEX "idx_payroll_entries_period_staff" ON "public"."payroll_entries" USING "btree" ("payroll_period_id", "staff_id");



CREATE INDEX "idx_payroll_entries_staff" ON "public"."payroll_entries" USING "btree" ("staff_id");



CREATE INDEX "idx_payroll_entries_staff_period" ON "public"."payroll_entries" USING "btree" ("staff_id", "payroll_period_id");



CREATE INDEX "idx_payroll_entries_total_days_in_period" ON "public"."payroll_entries" USING "btree" ("total_days_in_period");



CREATE INDEX "idx_payroll_periods_approved_at" ON "public"."payroll_periods" USING "btree" ("approved_at");



CREATE INDEX "idx_payroll_periods_closed_at" ON "public"."payroll_periods" USING "btree" ("closed_at");



CREATE INDEX "idx_payroll_periods_school" ON "public"."payroll_periods" USING "btree" ("school_id");



CREATE INDEX "idx_payroll_periods_status" ON "public"."payroll_periods" USING "btree" ("status");



CREATE INDEX "idx_payslips_staff" ON "public"."payslips" USING "btree" ("staff_id");



CREATE INDEX "idx_policy_assignments_assigned_to" ON "public"."policy_assignments" USING "btree" ("assigned_to_type", "assigned_to_id");



CREATE INDEX "idx_policy_assignments_policy_type" ON "public"."policy_assignments" USING "btree" ("policy_type");



CREATE INDEX "idx_policy_assignments_school_id" ON "public"."policy_assignments" USING "btree" ("school_id");



CREATE INDEX "idx_profiles_email_lower" ON "public"."profiles" USING "btree" ("lower"("email"));



CREATE INDEX "idx_profiles_mobile_number" ON "public"."profiles" USING "btree" ("mobile_number");



CREATE INDEX "idx_profiles_national_id" ON "public"."profiles" USING "btree" ("national_id_number");



CREATE INDEX "idx_school_content_school" ON "public"."school_content" USING "btree" ("school_id");



CREATE INDEX "idx_school_content_slug" ON "public"."school_content" USING "btree" ("slug");



CREATE INDEX "idx_schools_latitude" ON "public"."schools" USING "btree" ("latitude");



CREATE INDEX "idx_schools_longitude" ON "public"."schools" USING "btree" ("longitude");



CREATE INDEX "idx_session_attendance_session" ON "public"."session_attendance" USING "btree" ("session_id");



CREATE INDEX "idx_staff_employee_id" ON "public"."staff" USING "btree" ("employee_id");



CREATE INDEX "idx_staff_job_title" ON "public"."staff" USING "btree" ("job_title");



CREATE INDEX "idx_staff_role_specific_data" ON "public"."staff" USING "gin" ("role_specific_data");



CREATE INDEX "idx_status_history_created_at" ON "public"."student_status_history" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_status_history_new_status" ON "public"."student_status_history" USING "btree" ("new_status");



CREATE INDEX "idx_status_history_school_id" ON "public"."student_status_history" USING "btree" ("school_id");



CREATE INDEX "idx_status_history_student_id" ON "public"."student_status_history" USING "btree" ("student_id");



CREATE INDEX "idx_statutory_record_details_staff_id" ON "public"."statutory_record_details" USING "btree" ("staff_id");



CREATE INDEX "idx_statutory_record_details_statutory_record_id" ON "public"."statutory_record_details" USING "btree" ("statutory_record_id");



CREATE INDEX "idx_statutory_records_payroll_period_id" ON "public"."statutory_records" USING "btree" ("payroll_period_id");



CREATE INDEX "idx_statutory_records_period_type" ON "public"."statutory_records" USING "btree" ("payroll_period_id", "statutory_type");



CREATE INDEX "idx_statutory_records_school_id" ON "public"."statutory_records" USING "btree" ("school_id");



CREATE INDEX "idx_statutory_records_status" ON "public"."statutory_records" USING "btree" ("status");



CREATE INDEX "idx_statutory_records_statutory_type" ON "public"."statutory_records" USING "btree" ("statutory_type");



CREATE INDEX "idx_streams_school_id" ON "public"."streams" USING "btree" ("school_id");



CREATE INDEX "idx_student_history_academic_year" ON "public"."student_history" USING "btree" ("academic_year");



CREATE INDEX "idx_student_history_student_id" ON "public"."student_history" USING "btree" ("student_id");



CREATE INDEX "idx_student_remark_templates_active" ON "public"."student_remark_templates" USING "btree" ("is_active");



CREATE INDEX "idx_student_remark_templates_category" ON "public"."student_remark_templates" USING "btree" ("category");



CREATE INDEX "idx_student_remark_templates_school_id" ON "public"."student_remark_templates" USING "btree" ("school_id");



CREATE INDEX "idx_student_remarks_category" ON "public"."student_remarks" USING "btree" ("category");



CREATE INDEX "idx_student_remarks_class_id" ON "public"."student_remarks" USING "btree" ("class_id");



CREATE INDEX "idx_student_remarks_recorded_by" ON "public"."student_remarks" USING "btree" ("recorded_by");



CREATE INDEX "idx_student_remarks_school_id" ON "public"."student_remarks" USING "btree" ("school_id");



CREATE INDEX "idx_student_remarks_session_id" ON "public"."student_remarks" USING "btree" ("session_id");



CREATE INDEX "idx_student_remarks_student_id" ON "public"."student_remarks" USING "btree" ("student_id");



CREATE INDEX "idx_student_remarks_template_id" ON "public"."student_remarks" USING "btree" ("template_id");



CREATE INDEX "idx_students_class_level" ON "public"."students" USING "btree" ("class_level");



CREATE INDEX "idx_students_enrollment_status" ON "public"."students" USING "btree" ("enrollment_status");



CREATE INDEX "idx_students_status" ON "public"."students" USING "btree" ("status");



CREATE INDEX "idx_students_student_id" ON "public"."students" USING "btree" ("student_id");



CREATE INDEX "idx_subjects_departments_department_id" ON "public"."subjects_departments" USING "btree" ("department_id");



CREATE INDEX "idx_subjects_departments_subject_id" ON "public"."subjects_departments" USING "btree" ("subject_id");



CREATE INDEX "idx_subjects_is_active" ON "public"."subjects" USING "btree" ("is_active");



CREATE INDEX "idx_subjects_school_id" ON "public"."subjects" USING "btree" ("school_id");



CREATE INDEX "idx_subjects_subject_type" ON "public"."subjects" USING "btree" ("subject_type");



CREATE INDEX "idx_teacher_assignments_academic_year" ON "public"."teacher_assignments" USING "btree" ("academic_year_id");



CREATE INDEX "idx_teacher_assignments_assignment_type" ON "public"."teacher_assignments" USING "btree" ("assignment_type");



CREATE INDEX "idx_teacher_assignments_class_id" ON "public"."teacher_assignments" USING "btree" ("class_id");



CREATE INDEX "idx_teacher_assignments_class_teacher" ON "public"."teacher_assignments" USING "btree" ("is_class_teacher");



CREATE INDEX "idx_teacher_assignments_subclass_id" ON "public"."teacher_assignments" USING "btree" ("subclass_id");



CREATE INDEX "idx_teacher_assignments_subject_id" ON "public"."teacher_assignments" USING "btree" ("subject_id");



CREATE INDEX "idx_teacher_assignments_teacher_id" ON "public"."teacher_assignments" USING "btree" ("teacher_id");



CREATE INDEX "idx_teacher_assignments_term_id" ON "public"."teacher_assignments" USING "btree" ("term_id");



CREATE INDEX "idx_teachers_department_id" ON "public"."teachers" USING "btree" ("department_id");



CREATE INDEX "idx_teachers_user_id" ON "public"."teachers" USING "btree" ("user_id");



CREATE INDEX "idx_terms_sequence_order" ON "public"."terms" USING "btree" ("session_id", "sequence_order") WHERE ("session_id" IS NOT NULL);



CREATE INDEX "idx_timetable_entries_class" ON "public"."timetable_entries" USING "btree" ("class_id");



CREATE INDEX "idx_timetable_entries_day_period" ON "public"."timetable_entries" USING "btree" ("day_of_week", "period_id");



CREATE INDEX "idx_timetable_entries_room" ON "public"."timetable_entries" USING "btree" ("room_id");



CREATE INDEX "idx_timetable_entries_teacher" ON "public"."timetable_entries" USING "btree" ("teacher_id");



CREATE INDEX "idx_timetable_entries_timetable" ON "public"."timetable_entries" USING "btree" ("timetable_id");



CREATE INDEX "idx_timetable_periods_order" ON "public"."timetable_periods" USING "btree" ("period_order");



CREATE INDEX "idx_timetable_periods_school_id" ON "public"."timetable_periods" USING "btree" ("school_id");



CREATE INDEX "idx_timetable_rooms_school_id" ON "public"."timetable_rooms" USING "btree" ("school_id");



CREATE INDEX "idx_timetable_rooms_type" ON "public"."timetable_rooms" USING "btree" ("room_type");



CREATE INDEX "idx_timetable_subject_requirements_class" ON "public"."timetable_subject_requirements" USING "btree" ("class_id");



CREATE INDEX "idx_timetable_subject_requirements_subject" ON "public"."timetable_subject_requirements" USING "btree" ("subject_id");



CREATE INDEX "idx_timetable_teacher_absences_date" ON "public"."timetable_teacher_absences" USING "btree" ("date");



CREATE INDEX "idx_timetable_teacher_absences_teacher" ON "public"."timetable_teacher_absences" USING "btree" ("teacher_id");



CREATE INDEX "idx_timetable_teacher_absences_timetable" ON "public"."timetable_teacher_absences" USING "btree" ("timetable_id");



CREATE INDEX "idx_timetable_teacher_availability_day" ON "public"."timetable_teacher_availability" USING "btree" ("day_of_week");



CREATE INDEX "idx_timetable_teacher_availability_teacher" ON "public"."timetable_teacher_availability" USING "btree" ("teacher_id");



CREATE INDEX "idx_timetable_templates_default" ON "public"."timetable_templates" USING "btree" ("is_default");



CREATE INDEX "idx_timetable_templates_school_id" ON "public"."timetable_templates" USING "btree" ("school_id");



CREATE INDEX "idx_timetables_school_id" ON "public"."timetables" USING "btree" ("school_id");



CREATE INDEX "idx_timetables_status" ON "public"."timetables" USING "btree" ("status");



CREATE INDEX "idx_tip_analytics_created_at" ON "public"."tip_analytics" USING "btree" ("created_at");



CREATE INDEX "idx_tip_analytics_tip_id" ON "public"."tip_analytics" USING "btree" ("tip_id");



CREATE INDEX "idx_transport_billing_invoices_assignment_id" ON "public"."transport_billing_invoices" USING "btree" ("assignment_id");



CREATE INDEX "idx_transport_billing_invoices_invoice_date" ON "public"."transport_billing_invoices" USING "btree" ("invoice_date");



CREATE INDEX "idx_transport_billing_invoices_school_id" ON "public"."transport_billing_invoices" USING "btree" ("school_id");



CREATE INDEX "idx_transport_billing_invoices_status" ON "public"."transport_billing_invoices" USING "btree" ("status");



CREATE INDEX "idx_transport_billing_invoices_student_id" ON "public"."transport_billing_invoices" USING "btree" ("student_id");



CREATE INDEX "idx_transport_billing_month" ON "public"."transport_billing" USING "btree" ("billing_month");



CREATE INDEX "idx_transport_billing_payments_invoice_id" ON "public"."transport_billing_payments" USING "btree" ("invoice_id");



CREATE INDEX "idx_transport_billing_payments_payment_date" ON "public"."transport_billing_payments" USING "btree" ("payment_date");



CREATE INDEX "idx_transport_billing_payments_school_id" ON "public"."transport_billing_payments" USING "btree" ("school_id");



CREATE INDEX "idx_transport_billing_payments_student_id" ON "public"."transport_billing_payments" USING "btree" ("student_id");



CREATE INDEX "idx_transport_billing_rates_active" ON "public"."transport_billing_rates" USING "btree" ("active");



CREATE INDEX "idx_transport_billing_rates_route_type" ON "public"."transport_billing_rates" USING "btree" ("route_type");



CREATE INDEX "idx_transport_billing_rates_school_id" ON "public"."transport_billing_rates" USING "btree" ("school_id");



CREATE INDEX "idx_transport_billing_school" ON "public"."transport_billing" USING "btree" ("school_id");



CREATE INDEX "idx_transport_billing_student" ON "public"."transport_billing" USING "btree" ("student_id");



CREATE INDEX "idx_transport_bus_assignments_route" ON "public"."transport_bus_assignments" USING "btree" ("route_id");



CREATE INDEX "idx_transport_bus_assignments_school" ON "public"."transport_bus_assignments" USING "btree" ("school_id");



CREATE INDEX "idx_transport_bus_assignments_vehicle" ON "public"."transport_bus_assignments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_transport_driver_assignments_school" ON "public"."transport_driver_assignments" USING "btree" ("school_id");



CREATE INDEX "idx_transport_driver_assignments_staff" ON "public"."transport_driver_assignments" USING "btree" ("staff_id");



CREATE INDEX "idx_transport_driver_assignments_vehicle" ON "public"."transport_driver_assignments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_transport_routes_driver_id" ON "public"."transport_routes" USING "btree" ("driver_id");



CREATE INDEX "idx_transport_routes_route_type" ON "public"."transport_routes" USING "btree" ("route_type");



CREATE INDEX "idx_transport_routes_school" ON "public"."transport_routes" USING "btree" ("school_id");



CREATE INDEX "idx_transport_routes_vehicle_id" ON "public"."transport_routes" USING "btree" ("vehicle_id");



CREATE INDEX "idx_transport_stops_route" ON "public"."transport_stops" USING "btree" ("route_id");



CREATE INDEX "idx_transport_stops_school" ON "public"."transport_stops" USING "btree" ("school_id");



CREATE INDEX "idx_transport_student_assignments_dropoff_description" ON "public"."transport_student_assignments" USING "btree" ("dropoff_description");



CREATE INDEX "idx_transport_student_assignments_dropoff_route" ON "public"."transport_student_assignments" USING "btree" ("dropoff_route_id");



CREATE INDEX "idx_transport_student_assignments_pickup_description" ON "public"."transport_student_assignments" USING "btree" ("pickup_description");



CREATE INDEX "idx_transport_student_assignments_pickup_route" ON "public"."transport_student_assignments" USING "btree" ("pickup_route_id");



CREATE INDEX "idx_transport_student_assignments_route" ON "public"."transport_student_assignments" USING "btree" ("route_id");



CREATE INDEX "idx_transport_student_assignments_route_id" ON "public"."transport_student_assignments" USING "btree" ("route_id");



CREATE INDEX "idx_transport_student_assignments_school" ON "public"."transport_student_assignments" USING "btree" ("school_id");



CREATE INDEX "idx_transport_student_assignments_school_id" ON "public"."transport_student_assignments" USING "btree" ("school_id");



CREATE INDEX "idx_transport_student_assignments_status" ON "public"."transport_student_assignments" USING "btree" ("status");



CREATE INDEX "idx_transport_student_assignments_student" ON "public"."transport_student_assignments" USING "btree" ("student_id");



CREATE INDEX "idx_transport_student_assignments_student_id" ON "public"."transport_student_assignments" USING "btree" ("student_id");



CREATE INDEX "idx_transport_vehicle_assistant_assignments_assistant" ON "public"."transport_vehicle_assistant_assignments" USING "btree" ("assistant_id");



CREATE INDEX "idx_transport_vehicle_assistant_assignments_school" ON "public"."transport_vehicle_assistant_assignments" USING "btree" ("school_id");



CREATE INDEX "idx_transport_vehicle_assistant_assignments_status" ON "public"."transport_vehicle_assistant_assignments" USING "btree" ("status");



CREATE INDEX "idx_transport_vehicle_assistant_assignments_vehicle" ON "public"."transport_vehicle_assistant_assignments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_transport_vehicle_credentials_expiry_date" ON "public"."transport_vehicle_credentials" USING "btree" ("expiry_date");



CREATE INDEX "idx_transport_vehicle_credentials_school_id" ON "public"."transport_vehicle_credentials" USING "btree" ("school_id");



CREATE INDEX "idx_transport_vehicle_credentials_status" ON "public"."transport_vehicle_credentials" USING "btree" ("status");



CREATE INDEX "idx_transport_vehicle_credentials_vehicle_id" ON "public"."transport_vehicle_credentials" USING "btree" ("vehicle_id");



CREATE INDEX "idx_transport_vehicles_school" ON "public"."transport_vehicles" USING "btree" ("school_id");



CREATE INDEX "idx_user_events_start_time" ON "public"."user_events" USING "btree" ("start_time");



CREATE INDEX "idx_user_events_user_id" ON "public"."user_events" USING "btree" ("user_id");



CREATE INDEX "idx_user_permissions_audit_action" ON "public"."user_permissions_audit" USING "btree" ("action");



CREATE INDEX "idx_user_permissions_audit_performed_at" ON "public"."user_permissions_audit" USING "btree" ("performed_at" DESC);



CREATE INDEX "idx_user_permissions_audit_performed_by" ON "public"."user_permissions_audit" USING "btree" ("performed_by");



CREATE INDEX "idx_user_permissions_audit_school_id" ON "public"."user_permissions_audit" USING "btree" ("school_id");



CREATE INDEX "idx_user_permissions_audit_user_id" ON "public"."user_permissions_audit" USING "btree" ("user_id");



CREATE INDEX "idx_user_tips_state_last_view_date" ON "public"."user_tips_state" USING "btree" ("last_view_date");



CREATE INDEX "idx_user_tips_state_tip_id" ON "public"."user_tips_state" USING "btree" ("tip_id");



CREATE INDEX "idx_user_tips_state_user_id" ON "public"."user_tips_state" USING "btree" ("user_id");



CREATE UNIQUE INDEX "terms_school_current_unique" ON "public"."terms" USING "btree" ("school_id") WHERE ("is_current" = true);



CREATE UNIQUE INDEX "uq_transport_vehicles_reg_per_school" ON "public"."transport_vehicles" USING "btree" ("school_id", "registration_number");



CREATE OR REPLACE TRIGGER "auto_create_notification_preferences" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_notification_preferences"();



CREATE OR REPLACE TRIGGER "before_insert_session_sequence" BEFORE INSERT ON "public"."academic_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_session_sequence_order"();



CREATE OR REPLACE TRIGGER "ensure_single_current_session_trigger" BEFORE INSERT OR UPDATE ON "public"."academic_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_single_current_session"();



CREATE OR REPLACE TRIGGER "ensure_single_current_term_trigger" BEFORE INSERT OR UPDATE ON "public"."terms" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_single_current_term"();



CREATE OR REPLACE TRIGGER "log_permission_changes_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."log_permission_change"();



CREATE OR REPLACE TRIGGER "trg_parent_link_school_id" BEFORE INSERT ON "public"."parent_student_links" FOR EACH ROW EXECUTE FUNCTION "public"."set_parent_link_school_id"();



CREATE OR REPLACE TRIGGER "trg_parent_links_set_school_id" BEFORE INSERT OR UPDATE ON "public"."parent_student_links" FOR EACH ROW EXECUTE FUNCTION "public"."set_parent_link_school_id"();



CREATE OR REPLACE TRIGGER "trg_parent_links_updated_at" BEFORE INSERT OR UPDATE ON "public"."parent_student_links" FOR EACH ROW EXECUTE FUNCTION "public"."set_parent_links_updated_at"();



CREATE OR REPLACE TRIGGER "trg_school_content_updated_at" BEFORE UPDATE ON "public"."school_content" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_billing_updated_at" BEFORE UPDATE ON "public"."transport_billing" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_bus_assignments_updated_at" BEFORE UPDATE ON "public"."transport_bus_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_driver_assignments_updated_at" BEFORE UPDATE ON "public"."transport_driver_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_routes_updated_at" BEFORE UPDATE ON "public"."transport_routes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_stops_updated_at" BEFORE UPDATE ON "public"."transport_stops" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_student_assignments_updated_at" BEFORE UPDATE ON "public"."transport_student_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_transport_vehicles_updated_at" BEFORE UPDATE ON "public"."transport_vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_auto_create_terms" AFTER INSERT OR UPDATE ON "public"."academic_sessions" FOR EACH ROW WHEN (("new"."is_current" = true)) EXECUTE FUNCTION "public"."auto_create_terms_for_current_session"();



CREATE OR REPLACE TRIGGER "trigger_auto_transition_enrollments" AFTER UPDATE ON "public"."academic_sessions" FOR EACH ROW WHEN (("new"."is_current" = true)) EXECUTE FUNCTION "public"."auto_transition_enrollments_on_session_change"();



CREATE OR REPLACE TRIGGER "trigger_generate_student_id" BEFORE INSERT ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."generate_student_id"();



CREATE OR REPLACE TRIGGER "trigger_log_student_status_change" AFTER UPDATE ON "public"."students" FOR EACH ROW WHEN (("old"."status" IS DISTINCT FROM "new"."status")) EXECUTE FUNCTION "public"."log_student_status_change"();



CREATE OR REPLACE TRIGGER "trigger_set_emergency_contact_school_id" BEFORE INSERT OR UPDATE ON "public"."emergency_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_emergency_contact_school_id"();



CREATE OR REPLACE TRIGGER "trigger_set_parent_school_id" BEFORE INSERT OR UPDATE ON "public"."parents" FOR EACH ROW EXECUTE FUNCTION "public"."set_parent_school_id"();



CREATE OR REPLACE TRIGGER "trigger_set_teacher_school_id" BEFORE INSERT OR UPDATE ON "public"."teachers" FOR EACH ROW EXECUTE FUNCTION "public"."set_teacher_school_id"();



CREATE OR REPLACE TRIGGER "trigger_update_driver_ride_history_updated_at" BEFORE UPDATE ON "public"."driver_ride_history" FOR EACH ROW EXECUTE FUNCTION "public"."update_driver_ride_history_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_drivers_updated_at" BEFORE UPDATE ON "public"."drivers" FOR EACH ROW EXECUTE FUNCTION "public"."update_drivers_updated_at"();



CREATE OR REPLACE TRIGGER "update_academic_sessions_updated_at" BEFORE UPDATE ON "public"."academic_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_assessment_publications_updated_at" BEFORE UPDATE ON "public"."assessment_publications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_assessment_results_updated_at" BEFORE UPDATE ON "public"."assessment_results" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_assessment_types_updated_at" BEFORE UPDATE ON "public"."assessment_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_attendance_sessions_updated_at" BEFORE UPDATE ON "public"."attendance_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_attendance_updated_at" BEFORE UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_calendar_events_updated_at" BEFORE UPDATE ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_class_subjects_updated_at" BEFORE UPDATE ON "public"."class_subjects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_classes_updated_at" BEFORE UPDATE ON "public"."classes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_departments_updated_at" BEFORE UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_emergency_contacts_updated_at" BEFORE UPDATE ON "public"."emergency_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_enrollments_updated_at" BEFORE UPDATE ON "public"."enrollments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_exam_results_updated_at" BEFORE UPDATE ON "public"."exam_results" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_exams_updated_at" BEFORE UPDATE ON "public"."exams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fee_accounts_updated_at" BEFORE UPDATE ON "public"."fee_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fee_transactions_updated_at" BEFORE UPDATE ON "public"."fee_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_grading_policies_updated_at" BEFORE UPDATE ON "public"."grading_policies" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_grading_policy_grades_updated_at" BEFORE UPDATE ON "public"."grading_policy_grades" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_library_book_availability_on_insert_trigger" AFTER INSERT ON "public"."library_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_library_book_availability"();



CREATE OR REPLACE TRIGGER "update_library_book_availability_trigger" BEFORE UPDATE ON "public"."library_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_library_book_availability"();



CREATE OR REPLACE TRIGGER "update_library_books_updated_at" BEFORE UPDATE ON "public"."library_books" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_library_transactions_updated_at" BEFORE UPDATE ON "public"."library_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_parents_updated_at" BEFORE UPDATE ON "public"."parents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_payment_batches_updated_at" BEFORE UPDATE ON "public"."payment_batches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_payment_methods_updated_at" BEFORE UPDATE ON "public"."payment_methods" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_payment_transactions_updated_at" BEFORE UPDATE ON "public"."payment_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_policy_assignments_updated_at" BEFORE UPDATE ON "public"."policy_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schools_updated_at" BEFORE UPDATE ON "public"."schools" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_session_attendance_updated_at" BEFORE UPDATE ON "public"."session_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_staff_assignments_updated_at" BEFORE UPDATE ON "public"."staff_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_staff_updated_at" BEFORE UPDATE ON "public"."staff" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_streams_updated_at" BEFORE UPDATE ON "public"."streams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_history_updated_at" BEFORE UPDATE ON "public"."student_history" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_remark_templates_updated_at" BEFORE UPDATE ON "public"."student_remark_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_remarks_updated_at" BEFORE UPDATE ON "public"."student_remarks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_students_updated_at" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_subjects_updated_at" BEFORE UPDATE ON "public"."subjects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_teacher_assignments_updated_at" BEFORE UPDATE ON "public"."teacher_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_teachers_updated_at" BEFORE UPDATE ON "public"."teachers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_terms_updated_at" BEFORE UPDATE ON "public"."terms" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_events_updated_at" BEFORE UPDATE ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_push_tokens_updated_at" BEFORE UPDATE ON "public"."user_push_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_tips_state_updated_at_trigger" BEFORE UPDATE ON "public"."user_tips_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_tips_state_updated_at"();



CREATE OR REPLACE TRIGGER "validate_policy_assignment_trigger" BEFORE INSERT OR UPDATE ON "public"."policy_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."validate_policy_assignment"();



ALTER TABLE ONLY "public"."adjustments"
    ADD CONSTRAINT "adjustments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id");



ALTER TABLE ONLY "public"."adjustments"
    ADD CONSTRAINT "adjustments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."adjustments"
    ADD CONSTRAINT "adjustments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."adjustments"
    ADD CONSTRAINT "adjustments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessment_publications"
    ADD CONSTRAINT "assessment_publications_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."assessment_publications"
    ADD CONSTRAINT "assessment_publications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."assessment_publications"
    ADD CONSTRAINT "assessment_publications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."assessment_publications"
    ADD CONSTRAINT "assessment_publications_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_assessment_type_id_fkey" FOREIGN KEY ("assessment_type_id") REFERENCES "public"."assessment_types"("id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id");



ALTER TABLE ONLY "public"."assessment_results"
    ADD CONSTRAINT "assessment_results_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."assessment_types"
    ADD CONSTRAINT "assessment_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."assessment_types"
    ADD CONSTRAINT "assessment_types_grading_policy_id_fkey" FOREIGN KEY ("grading_policy_id") REFERENCES "public"."grading_policies"("id");



ALTER TABLE ONLY "public"."assessment_types"
    ADD CONSTRAINT "assessment_types_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_categories"
    ADD CONSTRAINT "asset_categories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_depreciation"
    ADD CONSTRAINT "asset_depreciation_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_maintenance"
    ADD CONSTRAINT "asset_maintenance_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_movements"
    ADD CONSTRAINT "asset_movements_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_movements"
    ADD CONSTRAINT "asset_movements_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_added_by_staff_id_fkey" FOREIGN KEY ("added_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_updated_by_staff_id_fkey" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."attendance_sessions"
    ADD CONSTRAINT "attendance_sessions_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."borrowing_transactions"
    ADD CONSTRAINT "borrowing_transactions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("asset_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."borrowing_transactions"
    ADD CONSTRAINT "borrowing_transactions_borrower_staff_id_fkey" FOREIGN KEY ("borrower_staff_id") REFERENCES "public"."staff"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."borrowing_transactions"
    ADD CONSTRAINT "borrowing_transactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."borrowing_transactions"
    ADD CONSTRAINT "borrowing_transactions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_subjects"
    ADD CONSTRAINT "class_subjects_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_subjects"
    ADD CONSTRAINT "class_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_teacher_assignments"
    ADD CONSTRAINT "class_teacher_assignments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."class_teacher_assignments"
    ADD CONSTRAINT "class_teacher_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."class_teacher_assignments"
    ADD CONSTRAINT "class_teacher_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_class_teacher_id_fkey" FOREIGN KEY ("class_teacher_id") REFERENCES "public"."teachers"("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_next_class_id_fkey" FOREIGN KEY ("next_class_id") REFERENCES "public"."classes"("class_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_parent_class_id_fkey" FOREIGN KEY ("parent_class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_head_of_department_fkey" FOREIGN KEY ("head_of_department") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."driver_ride_history"
    ADD CONSTRAINT "driver_ride_history_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_ride_history"
    ADD CONSTRAINT "driver_ride_history_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."driver_ride_history"
    ADD CONSTRAINT "driver_ride_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_ride_history"
    ADD CONSTRAINT "driver_ride_history_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_assigned_bus_id_fkey" FOREIGN KEY ("assigned_bus_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_class_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_student_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."event_recipients"
    ADD CONSTRAINT "event_recipients_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fee_accounts"
    ADD CONSTRAINT "fee_accounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fee_transactions"
    ADD CONSTRAINT "fee_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."fee_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fee_transactions"
    ADD CONSTRAINT "fee_transactions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fee_transactions"
    ADD CONSTRAINT "fee_transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."fee_transactions"
    ADD CONSTRAINT "fee_transactions_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."fixed_assets"
    ADD CONSTRAINT "fixed_assets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "fk_drivers_profiles" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "fk_drivers_staff_user" FOREIGN KEY ("user_id") REFERENCES "public"."staff"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_results"
    ADD CONSTRAINT "fk_exam_results_exam_id" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_results"
    ADD CONSTRAINT "fk_exam_results_student_id" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_books"
    ADD CONSTRAINT "fk_library_books_school_id" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_transactions"
    ADD CONSTRAINT "fk_library_transactions_book_id" FOREIGN KEY ("book_id") REFERENCES "public"."library_books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_transactions"
    ADD CONSTRAINT "fk_library_transactions_borrower_student" FOREIGN KEY ("borrower_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_transactions"
    ADD CONSTRAINT "fk_library_transactions_school_id" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "fk_school" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "fk_transport_assignments_route_id" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "fk_transport_assignments_vehicle_id" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "fk_user_roles_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grading_policies"
    ADD CONSTRAINT "grading_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."grading_policies"
    ADD CONSTRAINT "grading_policies_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."grading_policy_grades"
    ADD CONSTRAINT "grading_policy_grades_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."grading_policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."group_message_permissions"
    ADD CONSTRAINT "group_message_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."group_message_permissions"
    ADD CONSTRAINT "group_message_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_message_permissions"
    ADD CONSTRAINT "group_message_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_reads"
    ADD CONSTRAINT "group_reads_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_reads"
    ADD CONSTRAINT "group_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."inventory_borrowing_transactions"
    ADD CONSTRAINT "inventory_borrowing_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_borrowing_transactions"
    ADD CONSTRAINT "inventory_borrowing_transactions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_related_transaction_id_fkey" FOREIGN KEY ("related_transaction_id") REFERENCES "public"."inventory_transactions"("id");



ALTER TABLE ONLY "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_categories"
    ADD CONSTRAINT "library_categories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_transactions"
    ADD CONSTRAINT "library_transactions_staff_borrower_id_fkey" FOREIGN KEY ("staff_borrower_id") REFERENCES "public"."staff"("id");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."notification_logs"
    ADD CONSTRAINT "notification_logs_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_logs"
    ADD CONSTRAINT "notification_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parent_student_links"
    ADD CONSTRAINT "parent_student_links_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parent_student_links"
    ADD CONSTRAINT "parent_student_links_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parents"
    ADD CONSTRAINT "parents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_plans"
    ADD CONSTRAINT "payment_plans_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_plans"
    ADD CONSTRAINT "payment_plans_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_payment_batch_id_fkey" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payroll_allowances"
    ADD CONSTRAINT "payroll_allowances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_allowances"
    ADD CONSTRAINT "payroll_allowances_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."payroll_allowances"
    ADD CONSTRAINT "payroll_allowances_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."payroll_allowances"
    ADD CONSTRAINT "payroll_allowances_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id");



ALTER TABLE ONLY "public"."payroll_component_audit_log"
    ADD CONSTRAINT "payroll_component_audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_deductions"
    ADD CONSTRAINT "payroll_deductions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_deductions"
    ADD CONSTRAINT "payroll_deductions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."payroll_deductions"
    ADD CONSTRAINT "payroll_deductions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."payroll_deductions"
    ADD CONSTRAINT "payroll_deductions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_payroll_entry_id_fkey" FOREIGN KEY ("payroll_entry_id") REFERENCES "public"."payroll_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_requests"
    ADD CONSTRAINT "permission_requests_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("permission_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_requests"
    ADD CONSTRAINT "permission_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_requests"
    ADD CONSTRAINT "permission_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."policy_assignments"
    ADD CONSTRAINT "policy_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."policy_assignments"
    ADD CONSTRAINT "policy_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_attendance"
    ADD CONSTRAINT "session_attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."session_attendance"
    ADD CONSTRAINT "session_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_attendance"
    ADD CONSTRAINT "session_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statutory_record_details"
    ADD CONSTRAINT "statutory_record_details_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id");



ALTER TABLE ONLY "public"."statutory_record_details"
    ADD CONSTRAINT "statutory_record_details_statutory_record_id_fkey" FOREIGN KEY ("statutory_record_id") REFERENCES "public"."statutory_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statutory_records"
    ADD CONSTRAINT "statutory_records_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."statutory_records"
    ADD CONSTRAINT "statutory_records_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id");



ALTER TABLE ONLY "public"."statutory_records"
    ADD CONSTRAINT "statutory_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."statutory_records"
    ADD CONSTRAINT "statutory_records_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."student_history"
    ADD CONSTRAINT "student_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_remark_templates"
    ADD CONSTRAINT "student_remark_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."student_remark_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_remarks"
    ADD CONSTRAINT "student_remarks_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_status_history"
    ADD CONSTRAINT "student_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."student_status_history"
    ADD CONSTRAINT "student_status_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_status_history"
    ADD CONSTRAINT "student_status_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."subjects_departments"
    ADD CONSTRAINT "subjects_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."subjects_departments"
    ADD CONSTRAINT "subjects_departments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_sessions"("id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_subclass_id_fkey" FOREIGN KEY ("subclass_id") REFERENCES "public"."classes"("class_id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id");



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_assignments"
    ADD CONSTRAINT "teacher_assignments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id");



ALTER TABLE ONLY "public"."teachers"
    ADD CONSTRAINT "teachers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id");



ALTER TABLE ONLY "public"."teachers"
    ADD CONSTRAINT "teachers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id");



ALTER TABLE ONLY "public"."teachers"
    ADD CONSTRAINT "teachers_user_id_profiles_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."terms"
    ADD CONSTRAINT "terms_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."timetable_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."timetable_rooms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_entries"
    ADD CONSTRAINT "timetable_entries_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_periods"
    ADD CONSTRAINT "timetable_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_rooms"
    ADD CONSTRAINT "timetable_rooms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_subject_requirements"
    ADD CONSTRAINT "timetable_subject_requirements_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("class_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_subject_requirements"
    ADD CONSTRAINT "timetable_subject_requirements_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("subject_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_teacher_absences"
    ADD CONSTRAINT "timetable_teacher_absences_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."timetable_periods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."timetable_teacher_absences"
    ADD CONSTRAINT "timetable_teacher_absences_replacement_teacher_id_fkey" FOREIGN KEY ("replacement_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."timetable_teacher_absences"
    ADD CONSTRAINT "timetable_teacher_absences_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_teacher_absences"
    ADD CONSTRAINT "timetable_teacher_absences_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_teacher_availability"
    ADD CONSTRAINT "timetable_teacher_availability_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_teacher_availability"
    ADD CONSTRAINT "timetable_teacher_availability_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetable_templates"
    ADD CONSTRAINT "timetable_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetables"
    ADD CONSTRAINT "timetables_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timetables"
    ADD CONSTRAINT "timetables_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."timetable_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."timetables"
    ADD CONSTRAINT "timetables_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_billing"
    ADD CONSTRAINT "transport_billing_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."transport_student_assignments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_billing_invoices"
    ADD CONSTRAINT "transport_billing_invoices_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."transport_student_assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing_invoices"
    ADD CONSTRAINT "transport_billing_invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing_invoices"
    ADD CONSTRAINT "transport_billing_invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing_payments"
    ADD CONSTRAINT "transport_billing_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."transport_billing_invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing_payments"
    ADD CONSTRAINT "transport_billing_payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing_payments"
    ADD CONSTRAINT "transport_billing_payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing_rates"
    ADD CONSTRAINT "transport_billing_rates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_billing"
    ADD CONSTRAINT "transport_billing_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_bus_assignments"
    ADD CONSTRAINT "transport_bus_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_bus_assignments"
    ADD CONSTRAINT "transport_bus_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_driver_assignments"
    ADD CONSTRAINT "transport_driver_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_driver_assignments"
    ADD CONSTRAINT "transport_driver_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_routes"
    ADD CONSTRAINT "transport_routes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_routes"
    ADD CONSTRAINT "transport_routes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_stops"
    ADD CONSTRAINT "transport_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_dropoff_route_id_fkey" FOREIGN KEY ("dropoff_route_id") REFERENCES "public"."transport_routes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_dropoff_stop_id_fkey" FOREIGN KEY ("dropoff_stop_id") REFERENCES "public"."transport_stops"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_pickup_route_id_fkey" FOREIGN KEY ("pickup_route_id") REFERENCES "public"."transport_routes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_pickup_stop_id_fkey" FOREIGN KEY ("pickup_stop_id") REFERENCES "public"."transport_stops"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_student_assignments"
    ADD CONSTRAINT "transport_student_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_vehicle_assistant_assignments"
    ADD CONSTRAINT "transport_vehicle_assistant_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_vehicle_assistant_assignments"
    ADD CONSTRAINT "transport_vehicle_assistant_assignments_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_vehicle_assistant_assignments"
    ADD CONSTRAINT "transport_vehicle_assistant_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_vehicle_assistant_assignments"
    ADD CONSTRAINT "transport_vehicle_assistant_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_vehicle_credentials"
    ADD CONSTRAINT "transport_vehicle_credentials_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("school_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_vehicle_credentials"
    ADD CONSTRAINT "transport_vehicle_credentials_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("permission_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_tips_state"
    ADD CONSTRAINT "user_tips_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Accountants and admins can view transport billing in their scho" ON "public"."transport_billing" FOR SELECT USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Accountants can view class subjects" ON "public"."class_subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"));



CREATE POLICY "Accountants can view classes" ON "public"."classes" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"));



CREATE POLICY "Accountants can view enrollments for billing" ON "public"."enrollments" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"));



CREATE POLICY "Accountants can view streams" ON "public"."streams" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"));



CREATE POLICY "Accountants can view subjects" ON "public"."subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"));



CREATE POLICY "Admin can manage payment batches" ON "public"."payment_batches" USING (("auth"."uid"() IN ( SELECT "s"."user_id"
   FROM ("public"."staff" "s"
     JOIN "public"."user_roles" "ur" ON (("ur"."user_id" = "s"."user_id")))
  WHERE (("s"."school_id" = "payment_batches"."school_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role", 'accountant'::"public"."app_role"]))))));



CREATE POLICY "Admin can manage payment transactions" ON "public"."payment_transactions" USING (("auth"."uid"() IN ( SELECT "s"."user_id"
   FROM ("public"."staff" "s"
     JOIN "public"."user_roles" "ur" ON (("ur"."user_id" = "s"."user_id")))
  WHERE (("s"."school_id" = "payment_transactions"."school_id") AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role", 'accountant'::"public"."app_role"]))))));



CREATE POLICY "Admins and accountants can manage payroll periods in their scho" ON "public"."payroll_periods" TO "authenticated" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"))));



CREATE POLICY "Admins and superadmins can delete drivers" ON "public"."drivers" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins and superadmins can insert drivers" ON "public"."drivers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins and superadmins can update drivers" ON "public"."drivers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins and superadmins can view drivers" ON "public"."drivers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins and teachers can manage exams in their school" ON "public"."exams" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"))));



CREATE POLICY "Admins can create payroll entries for their school" ON "public"."payroll_entries" FOR INSERT TO "authenticated" WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))) AND (EXISTS ( SELECT 1
   FROM "public"."payroll_periods"
  WHERE (("payroll_periods"."id" = "payroll_entries"."payroll_period_id") AND ("payroll_periods"."school_id" = "payroll_entries"."school_id"))))));



CREATE POLICY "Admins can create payroll periods for their school" ON "public"."payroll_periods" FOR INSERT TO "authenticated" WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"])))))));



CREATE POLICY "Admins can delete events" ON "public"."calendar_events" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins can delete user roles" ON "public"."user_roles" FOR DELETE USING ("public"."is_admin_user"());



CREATE POLICY "Admins can insert events" ON "public"."calendar_events" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))) AND ("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Admins can insert user roles" ON "public"."user_roles" FOR INSERT WITH CHECK ("public"."is_admin_user"());



CREATE POLICY "Admins can manage all attendance in their school" ON "public"."attendance" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage all class subjects" ON "public"."class_subjects" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all classes" ON "public"."classes" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all departments" ON "public"."departments" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all emergency contacts" ON "public"."emergency_contacts" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all enrollments" ON "public"."enrollments" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all staff assignments" ON "public"."staff_assignments" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all streams" ON "public"."streams" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all student history" ON "public"."student_history" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage all subjects" ON "public"."subjects" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage attendance sessions in their school" ON "public"."attendance_sessions" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage bus assignments in their school" ON "public"."transport_bus_assignments" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage credentials in their school" ON "public"."transport_vehicle_credentials" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage driver assignments in their school" ON "public"."transport_driver_assignments" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage event recipients" ON "public"."event_recipients" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))) AND (EXISTS ( SELECT 1
   FROM "public"."calendar_events" "ce"
  WHERE (("ce"."id" = "event_recipients"."event_id") AND ("ce"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "Admins can manage parent-student links in their school" ON "public"."parent_student_links" TO "authenticated" USING ((("school_id" IN ( SELECT "p"."school_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "p"."school_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage permissions" ON "public"."permissions" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage routes in their school" ON "public"."transport_routes" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage school content" ON "public"."school_content" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage sessions in their school" ON "public"."academic_sessions" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage stops in their school" ON "public"."transport_stops" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage student transport assignments in their school" ON "public"."transport_student_assignments" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage terms in their school" ON "public"."terms" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage transport billing in their school" ON "public"."transport_billing" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can manage user permissions" ON "public"."user_permissions" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "Admins can manage vehicles in their school" ON "public"."transport_vehicles" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can update events" ON "public"."calendar_events" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins can update payroll entries for their school" ON "public"."payroll_entries" FOR UPDATE TO "authenticated" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))) WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Admins can update payroll periods for their school" ON "public"."payroll_periods" FOR UPDATE TO "authenticated" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))))) WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Admins can update permission requests" ON "public"."permission_requests" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "Admins can update their own school" ON "public"."schools" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"))))) WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role")))));



CREATE POLICY "Admins can update user roles" ON "public"."user_roles" FOR UPDATE USING ("public"."is_admin_user"());



CREATE POLICY "Admins can view all notification logs" ON "public"."notification_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'superadmin'::"public"."app_role"]))))));



CREATE POLICY "Admins can view all profiles" ON "public"."profiles" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_current_user_admin"()));



CREATE POLICY "Admins can view all roles" ON "public"."user_roles" FOR SELECT USING ("public"."is_current_user_admin"());



CREATE POLICY "Admins can view audit logs in their school" ON "public"."user_permissions_audit" FOR SELECT USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Admins can view tip analytics" ON "public"."tip_analytics" FOR SELECT USING (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "Allow authenticated users to delete transport student assignmen" ON "public"."transport_student_assignments" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to insert transport student assignmen" ON "public"."transport_student_assignments" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to update transport student assignmen" ON "public"."transport_student_assignments" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to view transport student assignments" ON "public"."transport_student_assignments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read for superadmin" ON "public"."academic_sessions" FOR SELECT USING (("auth"."role"() = 'superadmin'::"text"));



CREATE POLICY "Drivers can view their own driver assignments" ON "public"."transport_driver_assignments" FOR SELECT USING (("staff_id" IN ( SELECT "s"."id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Drivers can view their own record" ON "public"."drivers" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Librarians and admins can manage library books" ON "public"."library_books" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'librarian'::"public"."app_role"))));



CREATE POLICY "Librarians and staff can manage library transactions" ON "public"."library_transactions" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'librarian'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"))));



CREATE POLICY "Other staff can view classes" ON "public"."classes" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'other_staff'::"public"."app_role"));



CREATE POLICY "Other staff can view emergency contacts" ON "public"."emergency_contacts" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'other_staff'::"public"."app_role"));



CREATE POLICY "Other staff can view streams" ON "public"."streams" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'other_staff'::"public"."app_role"));



CREATE POLICY "Other staff can view subjects" ON "public"."subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'other_staff'::"public"."app_role"));



CREATE POLICY "Parents can update their own data" ON "public"."parents" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Parents can view class subjects" ON "public"."class_subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'parent'::"public"."app_role"));



CREATE POLICY "Parents can view classes" ON "public"."classes" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'parent'::"public"."app_role"));



CREATE POLICY "Parents can view enrollments for their wards" ON "public"."enrollments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."parent_student_links" "l"
  WHERE (("l"."student_id" = "enrollments"."student_id") AND ("l"."parent_user_id" = "auth"."uid"())))));



CREATE POLICY "Parents can view streams" ON "public"."streams" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'parent'::"public"."app_role"));



CREATE POLICY "Parents can view subjects" ON "public"."subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'parent'::"public"."app_role"));



CREATE POLICY "Parents can view teacher assignments" ON "public"."teacher_assignments" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'parent'::"public"."app_role"));



CREATE POLICY "Parents can view their children's exam results" ON "public"."exam_results" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."parent_student_links" "l"
  WHERE (("l"."student_id" = "exam_results"."student_id") AND ("l"."parent_user_id" = "auth"."uid"())))));



CREATE POLICY "Parents can view their children's fee accounts" ON "public"."fee_accounts" FOR SELECT USING (("student_id" IN ( SELECT "parent_student_links"."student_id"
   FROM "public"."parent_student_links"
  WHERE ("parent_student_links"."parent_user_id" = "auth"."uid"()))));



CREATE POLICY "Parents can view their children's fee transactions" ON "public"."fee_transactions" FOR SELECT USING (("account_id" IN ( SELECT "fa"."id"
   FROM ("public"."fee_accounts" "fa"
     JOIN "public"."parent_student_links" "psl" ON (("psl"."student_id" = "fa"."student_id")))
  WHERE ("psl"."parent_user_id" = "auth"."uid"()))));



CREATE POLICY "Parents can view their children's library transactions" ON "public"."library_transactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."parent_student_links" "psl"
  WHERE (("psl"."student_id" = "library_transactions"."borrower_id") AND ("psl"."parent_user_id" = "auth"."uid"())))));



CREATE POLICY "Parents can view their linked students" ON "public"."students" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."parent_student_links" "l"
  WHERE (("l"."student_id" = "students"."id") AND ("l"."parent_user_id" = "auth"."uid"())))));



CREATE POLICY "Parents can view their own data" ON "public"."parents" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Parents can view their own parent-student links" ON "public"."parent_student_links" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "parent_user_id"));



CREATE POLICY "Public staff directory access" ON "public"."staff" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School admins can create students in their school" ON "public"."students" FOR INSERT WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "School admins can manage fee accounts" ON "public"."fee_accounts" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"))));



CREATE POLICY "School admins can manage fee transactions" ON "public"."fee_transactions" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'accountant'::"public"."app_role"))));



CREATE POLICY "School admins can manage parents in their school" ON "public"."parents" USING (((("school_id" IN ( SELECT "p"."school_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))) OR ("auth"."uid"() = "user_id"))) WITH CHECK (((("school_id" IN ( SELECT "p"."school_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))) OR ("auth"."uid"() = "user_id")));



CREATE POLICY "School admins can manage staff in their school" ON "public"."staff" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "School admins can manage streams" ON "public"."streams" USING (((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))) OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "School admins can manage students in their school" ON "public"."students" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "School admins can manage subjects" ON "public"."subjects" USING (((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))) OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "School admins can manage teacher assignments in their school" ON "public"."teacher_assignments" USING ((("class_id" IN ( SELECT "c"."class_id"
   FROM "public"."classes" "c"
  WHERE ("c"."school_id" IN ( SELECT "p"."school_id"
           FROM "public"."profiles" "p"
          WHERE ("p"."user_id" = "auth"."uid"()))))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")))) WITH CHECK ((("class_id" IN ( SELECT "c"."class_id"
   FROM "public"."classes" "c"
  WHERE ("c"."school_id" IN ( SELECT "p"."school_id"
           FROM "public"."profiles" "p"
          WHERE ("p"."user_id" = "auth"."uid"()))))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "School admins can manage teachers in their school" ON "public"."teachers" USING (((("school_id" IN ( SELECT "p"."school_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))) OR ("auth"."uid"() = "user_id"))) WITH CHECK (((("school_id" IN ( SELECT "p"."school_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))) OR ("auth"."uid"() = "user_id")));



CREATE POLICY "School users can view attendance in their school" ON "public"."attendance" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view attendance sessions in their school" ON "public"."attendance_sessions" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view bus assignments in their school" ON "public"."transport_bus_assignments" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view driver assignments in their school" ON "public"."transport_driver_assignments" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view exam results in their school" ON "public"."exam_results" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view exams in their school" ON "public"."exams" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view library books in their school" ON "public"."library_books" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view library transactions in their school" ON "public"."library_transactions" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view routes in their school" ON "public"."transport_routes" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view school content" ON "public"."school_content" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view session attendance in their school" ON "public"."session_attendance" FOR SELECT USING (("session_id" IN ( SELECT "attendance_sessions"."id"
   FROM "public"."attendance_sessions"
  WHERE ("attendance_sessions"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "School users can view sessions in their school" ON "public"."academic_sessions" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view staff in their school" ON "public"."staff" FOR SELECT USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_access"("auth"."uid"(), 'staff_management'::"text", 'read'::"public"."crud_operation", 'staff_profile'::"text") OR "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR ("auth"."uid"() = "user_id"))));



CREATE POLICY "School users can view stops in their school" ON "public"."transport_stops" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view streams in their school" ON "public"."streams" FOR SELECT USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "School users can view student transport assignments in their sc" ON "public"."transport_student_assignments" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view students in their school" ON "public"."students" FOR SELECT USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"))));



CREATE POLICY "School users can view subjects in their school" ON "public"."subjects" FOR SELECT USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "School users can view terms in their school" ON "public"."terms" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "School users can view vehicles in their school" ON "public"."transport_vehicles" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Staff can insert own payment methods" ON "public"."payment_methods" FOR INSERT WITH CHECK (("auth"."uid"() IN ( SELECT "staff"."user_id"
   FROM "public"."staff"
  WHERE ("staff"."id" = "payment_methods"."staff_id"))));



CREATE POLICY "Staff can update own payment methods" ON "public"."payment_methods" FOR UPDATE USING (("auth"."uid"() IN ( SELECT "staff"."user_id"
   FROM "public"."staff"
  WHERE ("staff"."id" = "payment_methods"."staff_id"))));



CREATE POLICY "Staff can update their own data in their school" ON "public"."staff" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Staff can view colleague assignments" ON "public"."staff_assignments" FOR SELECT USING (("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'other_staff'::"public"."app_role")));



CREATE POLICY "Staff can view departments" ON "public"."departments" FOR SELECT USING (("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'other_staff'::"public"."app_role")));



CREATE POLICY "Staff can view own payment methods" ON "public"."payment_methods" FOR SELECT USING (("auth"."uid"() IN ( SELECT "staff"."user_id"
   FROM "public"."staff"
  WHERE ("staff"."id" = "payment_methods"."staff_id"))));



CREATE POLICY "Staff can view own transactions" ON "public"."payment_transactions" FOR SELECT USING (("auth"."uid"() IN ( SELECT "staff"."user_id"
   FROM "public"."staff"
  WHERE ("staff"."id" = "payment_transactions"."staff_id"))));



CREATE POLICY "Staff can view payroll periods in their school" ON "public"."payroll_periods" FOR SELECT TO "authenticated" USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Staff can view school profiles" ON "public"."profiles" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_current_user_admin"() OR "public"."can_view_staff_profiles"("user_id")));



CREATE POLICY "Staff can view their own assignments" ON "public"."staff_assignments" FOR SELECT USING (("staff_id" IN ( SELECT "staff"."id"
   FROM "public"."staff"
  WHERE ("staff"."user_id" = "auth"."uid"()))));



CREATE POLICY "Staff can view their own attendance" ON "public"."attendance" FOR SELECT USING (("staff_id" IN ( SELECT "staff"."id"
   FROM "public"."staff"
  WHERE ("staff"."user_id" = "auth"."uid"()))));



CREATE POLICY "Staff can view their own payroll entries" ON "public"."payroll_entries" FOR SELECT USING (("auth"."uid"() IN ( SELECT "staff"."user_id"
   FROM "public"."staff"
  WHERE ("staff"."id" = "payroll_entries"."staff_id"))));



CREATE POLICY "Staff can view their own payslips" ON "public"."payslips" FOR SELECT USING (("auth"."uid"() IN ( SELECT "staff"."user_id"
   FROM "public"."staff"
  WHERE ("staff"."id" = "payslips"."staff_id"))));



CREATE POLICY "Superadmin can delete payroll entries" ON "public"."payroll_entries" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'superadmin'::"public"."app_role")))));



CREATE POLICY "Superadmin can delete payroll periods" ON "public"."payroll_periods" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'superadmin'::"public"."app_role")))));



CREATE POLICY "Superadmin can read all sessions" ON "public"."academic_sessions" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmin can read all terms" ON "public"."terms" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can delete profiles" ON "public"."profiles" FOR DELETE USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can insert profiles" ON "public"."profiles" FOR INSERT WITH CHECK ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all class subjects" ON "public"."class_subjects" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all classes" ON "public"."classes" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all departments" ON "public"."departments" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all emergency contacts" ON "public"."emergency_contacts" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all enrollments" ON "public"."enrollments" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all parents" ON "public"."parents" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all payroll periods" ON "public"."payroll_periods" TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")) WITH CHECK ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all permissions" ON "public"."permissions" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all roles" ON "public"."user_roles" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all schools" ON "public"."schools" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")) WITH CHECK ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all staff assignments" ON "public"."staff_assignments" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all streams" ON "public"."streams" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all student history" ON "public"."student_history" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all subjects" ON "public"."subjects" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all teachers" ON "public"."teachers" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can manage all user permissions" ON "public"."user_permissions" USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Superadmins can update all profiles" ON "public"."profiles" FOR UPDATE USING ("public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"));



CREATE POLICY "Teachers and admins can manage exam results in their school" ON "public"."exam_results" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"))));



CREATE POLICY "Teachers can create students in their school" ON "public"."students" FOR INSERT WITH CHECK ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role")));



CREATE POLICY "Teachers can enroll students in their assigned classes" ON "public"."enrollments" FOR INSERT WITH CHECK (("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") AND ("class_id" IS NOT NULL) AND "public"."is_teacher_assigned_to_class"("auth"."uid"(), "class_id")));



CREATE POLICY "Teachers can insert their own assignments" ON "public"."teacher_assignments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teachers"
  WHERE (("teachers"."id" = "teacher_assignments"."teacher_id") AND ("teachers"."user_id" = "auth"."uid"())))));



CREATE POLICY "Teachers can manage attendance" ON "public"."attendance" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role")));



CREATE POLICY "Teachers can manage session attendance" ON "public"."session_attendance" USING ((("session_id" IN ( SELECT "attendance_sessions"."id"
   FROM "public"."attendance_sessions"
  WHERE (("attendance_sessions"."teacher_id" = "auth"."uid"()) OR ("attendance_sessions"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"())))))) AND ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role"))));



CREATE POLICY "Teachers can manage their attendance sessions" ON "public"."attendance_sessions" USING ((("teacher_id" = "auth"."uid"()) OR (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) AND "public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"))));



CREATE POLICY "Teachers can remove enrollments in their assigned classes" ON "public"."enrollments" FOR DELETE USING (("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") AND ("class_id" IS NOT NULL) AND "public"."is_teacher_assigned_to_class"("auth"."uid"(), "class_id")));



CREATE POLICY "Teachers can update behavioral notes" ON "public"."student_history" FOR UPDATE USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can update enrollments in their assigned classes" ON "public"."enrollments" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") AND ("class_id" IS NOT NULL) AND "public"."is_teacher_assigned_to_class"("auth"."uid"(), "class_id"))) WITH CHECK (("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role") AND ("class_id" IS NOT NULL) AND "public"."is_teacher_assigned_to_class"("auth"."uid"(), "class_id")));



CREATE POLICY "Teachers can update subject information" ON "public"."subjects" FOR UPDATE USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view all assignments" ON "public"."teacher_assignments" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view and update student history" ON "public"."student_history" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view and update subjects" ON "public"."subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view class subjects" ON "public"."class_subjects" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view classes" ON "public"."classes" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view emergency contacts" ON "public"."emergency_contacts" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view enrollments" ON "public"."enrollments" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view streams" ON "public"."streams" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'teacher'::"public"."app_role"));



CREATE POLICY "Teachers can view their own assignments" ON "public"."teacher_assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teachers"
  WHERE (("teachers"."id" = "teacher_assignments"."teacher_id") AND ("teachers"."user_id" = "auth"."uid"())))));



CREATE POLICY "Teachers can view their own teacher record" ON "public"."teachers" FOR SELECT USING (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can create permission requests" ON "public"."permission_requests" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete drivers from their school" ON "public"."drivers" FOR DELETE USING (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete remark templates for their school" ON "public"."student_remark_templates" FOR DELETE USING (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can delete remarks for their school" ON "public"."student_remarks" FOR DELETE USING (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can delete ride history from their school" ON "public"."driver_ride_history" FOR DELETE USING (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their own events" ON "public"."user_events" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their school's assessment types" ON "public"."assessment_types" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's asset categories" ON "public"."asset_categories" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's assets" ON "public"."assets" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's assets" ON "public"."fixed_assets" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's borrowing transactions" ON "public"."inventory_borrowing_transactions" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's grading policies" ON "public"."grading_policies" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's inventory items" ON "public"."inventory_items" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's inventory transactions" ON "public"."inventory_transactions" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's subject requirements" ON "public"."timetable_subject_requirements" FOR DELETE USING (("class_id" IN ( SELECT "classes"."class_id"
   FROM "public"."classes"
  WHERE ("classes"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can delete their school's teacher absences" ON "public"."timetable_teacher_absences" FOR DELETE USING (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can delete their school's teacher availability" ON "public"."timetable_teacher_availability" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's timetable entries" ON "public"."timetable_entries" FOR DELETE USING (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can delete their school's timetable periods" ON "public"."timetable_periods" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's timetable rooms" ON "public"."timetable_rooms" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's timetable templates" ON "public"."timetable_templates" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can delete their school's timetables" ON "public"."timetables" FOR DELETE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert asset categories for their school" ON "public"."asset_categories" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert assets for their school" ON "public"."assets" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert assets for their school" ON "public"."fixed_assets" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert assignments for their school's assets" ON "public"."asset_assignments" FOR INSERT WITH CHECK (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert borrowing transactions for their school" ON "public"."borrowing_transactions" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert borrowing transactions for their school" ON "public"."inventory_borrowing_transactions" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert depreciation for their school's assets" ON "public"."asset_depreciation" FOR INSERT WITH CHECK (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert drivers to their school" ON "public"."drivers" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert inventory items for their school" ON "public"."inventory_items" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert inventory transactions for their school" ON "public"."inventory_transactions" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert maintenance for their school's assets" ON "public"."asset_maintenance" FOR INSERT WITH CHECK (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert movements for their school's assets" ON "public"."asset_movements" FOR INSERT WITH CHECK (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert own preferences" ON "public"."notification_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own tip states" ON "public"."user_tips_state" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert remark templates for their school" ON "public"."student_remark_templates" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can insert remarks for their school" ON "public"."student_remarks" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can insert ride history to their school" ON "public"."driver_ride_history" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert status history for their school" ON "public"."student_status_history" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert subject requirements for their school" ON "public"."timetable_subject_requirements" FOR INSERT WITH CHECK (("class_id" IN ( SELECT "classes"."class_id"
   FROM "public"."classes"
  WHERE ("classes"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert teacher absences for their school" ON "public"."timetable_teacher_absences" FOR INSERT WITH CHECK (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert teacher availability for their school" ON "public"."timetable_teacher_availability" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own events" ON "public"."user_events" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their school's assessment results" ON "public"."assessment_results" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their school's assessment types" ON "public"."assessment_types" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their school's grading policies" ON "public"."grading_policies" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert timetable entries for their school" ON "public"."timetable_entries" FOR INSERT WITH CHECK (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert timetable periods for their school" ON "public"."timetable_periods" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert timetable rooms for their school" ON "public"."timetable_rooms" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert timetable templates for their school" ON "public"."timetable_templates" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert timetables for their school" ON "public"."timetables" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert tip analytics" ON "public"."tip_analytics" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can manage grades for their school's policies" ON "public"."grading_policy_grades" USING (("policy_id" IN ( SELECT "grading_policies"."id"
   FROM "public"."grading_policies"
  WHERE ("grading_policies"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can manage their school's assessment publications" ON "public"."assessment_publications" USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can manage their school's policy assignments" ON "public"."policy_assignments" USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update assignments for their school's assets" ON "public"."asset_assignments" FOR UPDATE USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update drivers from their school" ON "public"."drivers" FOR UPDATE USING (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update maintenance for their school's assets" ON "public"."asset_maintenance" FOR UPDATE USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update movements for their school's assets" ON "public"."asset_movements" FOR UPDATE USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update own preferences" ON "public"."notification_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own tip states" ON "public"."user_tips_state" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update remark templates for their school" ON "public"."student_remark_templates" FOR UPDATE USING (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can update remarks for their school" ON "public"."student_remarks" FOR UPDATE USING (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can update ride history from their school" ON "public"."driver_ride_history" FOR UPDATE USING (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their own events" ON "public"."user_events" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their school's assessment results" ON "public"."assessment_results" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's assessment types" ON "public"."assessment_types" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's asset categories" ON "public"."asset_categories" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's assets" ON "public"."assets" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's assets" ON "public"."fixed_assets" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's borrowing transactions" ON "public"."borrowing_transactions" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's borrowing transactions" ON "public"."inventory_borrowing_transactions" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's grading policies" ON "public"."grading_policies" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's inventory items" ON "public"."inventory_items" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's inventory transactions" ON "public"."inventory_transactions" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's subject requirements" ON "public"."timetable_subject_requirements" FOR UPDATE USING (("class_id" IN ( SELECT "classes"."class_id"
   FROM "public"."classes"
  WHERE ("classes"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update their school's teacher absences" ON "public"."timetable_teacher_absences" FOR UPDATE USING (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update their school's teacher availability" ON "public"."timetable_teacher_availability" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's timetable entries" ON "public"."timetable_entries" FOR UPDATE USING (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update their school's timetable periods" ON "public"."timetable_periods" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's timetable rooms" ON "public"."timetable_rooms" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's timetable templates" ON "public"."timetable_templates" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their school's timetables" ON "public"."timetables" FOR UPDATE USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view assignments for their school's assets" ON "public"."asset_assignments" FOR SELECT USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view credentials in their school" ON "public"."transport_vehicle_credentials" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view depreciation for their school's assets" ON "public"."asset_depreciation" FOR SELECT USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view drivers from their school" ON "public"."drivers" FOR SELECT USING (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view events for their school" ON "public"."calendar_events" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view grades for their school's policies" ON "public"."grading_policy_grades" FOR SELECT USING (("policy_id" IN ( SELECT "grading_policies"."id"
   FROM "public"."grading_policies"
  WHERE ("grading_policies"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view maintenance for their school's assets" ON "public"."asset_maintenance" FOR SELECT USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view movements for their school's assets" ON "public"."asset_movements" FOR SELECT USING (("asset_id" IN ( SELECT "fixed_assets"."id"
   FROM "public"."fixed_assets"
  WHERE ("fixed_assets"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view own preferences" ON "public"."notification_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own tip states" ON "public"."user_tips_state" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view payroll entries for their school" ON "public"."payroll_entries" FOR SELECT TO "authenticated" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'superadmin'::"public"."app_role"))))));



CREATE POLICY "Users can view payroll periods for their school" ON "public"."payroll_periods" FOR SELECT TO "authenticated" USING ((("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'superadmin'::"public"."app_role"))))));



CREATE POLICY "Users can view remark templates for their school" ON "public"."student_remark_templates" FOR SELECT USING (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can view remarks for their school" ON "public"."student_remarks" FOR SELECT USING (("school_id" IN ( SELECT "public"."get_user_schools"() AS "get_user_schools")));



CREATE POLICY "Users can view ride history from their school" ON "public"."driver_ride_history" FOR SELECT USING (("school_id" IN ( SELECT "s"."school_id"
   FROM "public"."staff" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view roles for staff in their school" ON "public"."user_roles" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_current_user_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."staff" "s1",
    "public"."staff" "s2"
  WHERE (("s1"."user_id" = "auth"."uid"()) AND ("s2"."user_id" = "user_roles"."user_id") AND ("s1"."school_id" = "s2"."school_id"))))));



CREATE POLICY "Users can view status history for their school" ON "public"."student_status_history" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own events" ON "public"."user_events" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own permission requests" ON "public"."permission_requests" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("auth"."uid"() = "requested_by") OR "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'superadmin'::"public"."app_role")));



CREATE POLICY "Users can view their own permissions" ON "public"."user_permissions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own school" ON "public"."schools" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's assessment publications" ON "public"."assessment_publications" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's assessment results" ON "public"."assessment_results" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's assessment types" ON "public"."assessment_types" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's asset categories" ON "public"."asset_categories" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's assets" ON "public"."assets" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's assets" ON "public"."fixed_assets" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's borrowing transactions" ON "public"."borrowing_transactions" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's borrowing transactions" ON "public"."inventory_borrowing_transactions" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's grading policies" ON "public"."grading_policies" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's inventory items" ON "public"."inventory_items" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's inventory transactions" ON "public"."inventory_transactions" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's policy assignments" ON "public"."policy_assignments" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's subject requirements" ON "public"."timetable_subject_requirements" FOR SELECT USING (("class_id" IN ( SELECT "classes"."class_id"
   FROM "public"."classes"
  WHERE ("classes"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view their school's teacher absences" ON "public"."timetable_teacher_absences" FOR SELECT USING (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view their school's teacher availability" ON "public"."timetable_teacher_availability" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's timetable entries" ON "public"."timetable_entries" FOR SELECT USING (("timetable_id" IN ( SELECT "timetables"."id"
   FROM "public"."timetables"
  WHERE ("timetables"."school_id" IN ( SELECT "profiles"."school_id"
           FROM "public"."profiles"
          WHERE ("profiles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view their school's timetable periods" ON "public"."timetable_periods" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's timetable rooms" ON "public"."timetable_rooms" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's timetable templates" ON "public"."timetable_templates" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their school's timetables" ON "public"."timetables" FOR SELECT USING (("school_id" IN ( SELECT "profiles"."school_id"
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."academic_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow_admins_update_notification_preferences" ON "public"."notification_preferences" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) AND ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role") OR "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'superadmin'::"public"."app_role")))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE ("profiles"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) AND ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role") OR "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'superadmin'::"public"."app_role"))));



ALTER TABLE "public"."assessment_publications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assessment_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assessment_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_depreciation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_maintenance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."borrowing_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."class_subjects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."classes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_ride_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drivers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emergency_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exam_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fee_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fee_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fixed_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grading_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grading_policy_grades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_borrowing_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."library_books" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."library_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parent_student_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payslips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permission_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."policy_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."school_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."schools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."streams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_remark_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_remarks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_status_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teacher_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teachers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."terms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_subject_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_teacher_absences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_teacher_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetable_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timetables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tip_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_billing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_billing_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_billing_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_billing_rates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_bus_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_driver_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_routes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_stops" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_student_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_vehicle_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_permissions_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_tips_state" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_set_custom_permissions"("target_user_id" "uuid", "enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_custom_permissions"("target_user_id" "uuid", "enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_custom_permissions"("target_user_id" "uuid", "enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_permission_request"("request_id" "uuid", "review_notes_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_permission_request"("request_id" "uuid", "review_notes_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_permission_request"("request_id" "uuid", "review_notes_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "user_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "user_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "user_role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_create_terms_for_current_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_create_terms_for_current_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_create_terms_for_current_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_transition_enrollments_on_session_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_transition_enrollments_on_session_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_transition_enrollments_on_session_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_update_student_status"("student_ids" "uuid"[], "new_status" "text", "reason" "text", "notes" "text", "effective_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_update_student_status"("student_ids" "uuid"[], "new_status" "text", "reason" "text", "notes" "text", "effective_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_update_student_status"("student_ids" "uuid"[], "new_status" "text", "reason" "text", "notes" "text", "effective_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_amount_effective"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_amount_effective"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_amount_effective"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_effective_amount"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_effective_amount"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_effective_amount"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_loan_payment"("p_principal" numeric, "p_annual_rate" numeric, "p_months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_loan_payment"("p_principal" numeric, "p_annual_rate" numeric, "p_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_loan_payment"("p_principal" numeric, "p_annual_rate" numeric, "p_months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_payroll_entry"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_payroll_entry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_payroll_entry"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_user_view_event"("event_id" "uuid", "user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_user_view_event"("event_id" "uuid", "user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_user_view_event"("event_id" "uuid", "user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_staff_profiles"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_staff_profiles"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_staff_profiles"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_user_with_profile_and_role"("p_email" "text", "p_password" "text", "p_full_name" "text", "p_role" "text", "p_school_id" "uuid", "p_employee_id" "text", "p_title" "text", "p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_sex" "text", "p_date_of_birth" "date", "p_marital_status" "text", "p_number_of_children" integer, "p_national_id_type" "text", "p_national_id_number" "text", "p_residential_address" "text", "p_mobile_number" "text", "p_secondary_mobile" "text", "p_next_of_kin_name" "text", "p_next_of_kin_relationship" "text", "p_next_of_kin_phone" "text", "p_emergency_contact_name" "text", "p_emergency_contact_phone" "text", "p_department_id" "uuid", "p_position_id" "uuid", "p_hire_date" "date", "p_job_description" "text", "p_salary" numeric, "p_phone" "text", "p_address" "text", "p_emergency_contact" "text", "p_contract_type" "text", "p_employment_type" "text", "p_job_title" "text", "p_staff_category" "text", "p_qualification" "text", "p_basic_salary_gross" numeric, "p_payment_mode" "text", "p_bank_name" "text", "p_bank_account_number" "text", "p_bank_branch" "text", "p_ssnit_contributor" boolean, "p_ssnit_number" "text", "p_tin_number" "text", "p_license_number" "text", "p_license_expiry_date" "date", "p_license_type" "text", "p_teaching_license_number" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_user_with_profile_and_role"("p_email" "text", "p_password" "text", "p_full_name" "text", "p_role" "text", "p_school_id" "uuid", "p_employee_id" "text", "p_title" "text", "p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_sex" "text", "p_date_of_birth" "date", "p_marital_status" "text", "p_number_of_children" integer, "p_national_id_type" "text", "p_national_id_number" "text", "p_residential_address" "text", "p_mobile_number" "text", "p_secondary_mobile" "text", "p_next_of_kin_name" "text", "p_next_of_kin_relationship" "text", "p_next_of_kin_phone" "text", "p_emergency_contact_name" "text", "p_emergency_contact_phone" "text", "p_department_id" "uuid", "p_position_id" "uuid", "p_hire_date" "date", "p_job_description" "text", "p_salary" numeric, "p_phone" "text", "p_address" "text", "p_emergency_contact" "text", "p_contract_type" "text", "p_employment_type" "text", "p_job_title" "text", "p_staff_category" "text", "p_qualification" "text", "p_basic_salary_gross" numeric, "p_payment_mode" "text", "p_bank_name" "text", "p_bank_account_number" "text", "p_bank_branch" "text", "p_ssnit_contributor" boolean, "p_ssnit_number" "text", "p_tin_number" "text", "p_license_number" "text", "p_license_expiry_date" "date", "p_license_type" "text", "p_teaching_license_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_user_with_profile_and_role"("p_email" "text", "p_password" "text", "p_full_name" "text", "p_role" "text", "p_school_id" "uuid", "p_employee_id" "text", "p_title" "text", "p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_sex" "text", "p_date_of_birth" "date", "p_marital_status" "text", "p_number_of_children" integer, "p_national_id_type" "text", "p_national_id_number" "text", "p_residential_address" "text", "p_mobile_number" "text", "p_secondary_mobile" "text", "p_next_of_kin_name" "text", "p_next_of_kin_relationship" "text", "p_next_of_kin_phone" "text", "p_emergency_contact_name" "text", "p_emergency_contact_phone" "text", "p_department_id" "uuid", "p_position_id" "uuid", "p_hire_date" "date", "p_job_description" "text", "p_salary" numeric, "p_phone" "text", "p_address" "text", "p_emergency_contact" "text", "p_contract_type" "text", "p_employment_type" "text", "p_job_title" "text", "p_staff_category" "text", "p_qualification" "text", "p_basic_salary_gross" numeric, "p_payment_mode" "text", "p_bank_name" "text", "p_bank_account_number" "text", "p_bank_branch" "text", "p_ssnit_contributor" boolean, "p_ssnit_number" "text", "p_tin_number" "text", "p_license_number" "text", "p_license_expiry_date" "date", "p_license_type" "text", "p_teaching_license_number" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."deny_permission_request"("request_id" "uuid", "review_notes_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."deny_permission_request"("request_id" "uuid", "review_notes_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deny_permission_request"("request_id" "uuid", "review_notes_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_current_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_current_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_current_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_current_term"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_current_term"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_current_term"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_employee_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_employee_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_employee_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_fee_account_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_fee_account_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_fee_account_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_student_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_student_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_student_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_attendance_summary"("school_id" "uuid", "days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_attendance_summary"("school_id" "uuid", "days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_attendance_summary"("school_id" "uuid", "days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_attendance_summary_by_class"("class_ids" "uuid"[], "school_id" "uuid", "days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_attendance_summary_by_class"("class_ids" "uuid"[], "school_id" "uuid", "days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_attendance_summary_by_class"("class_ids" "uuid"[], "school_id" "uuid", "days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_class_relationships"("school_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_class_relationships"("school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_class_relationships"("school_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_session"("_school_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_session"("_school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_session"("_school_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_term"("_school_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_term"("_school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_term"("_school_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_departments_with_counts"("school_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_departments_with_counts"("school_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_departments_with_counts"("school_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_session"("_school_id" "uuid", "_current_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_session"("_school_id" "uuid", "_current_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_session"("_school_id" "uuid", "_current_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_permission_requests_count"("school_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_permission_requests_count"("school_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_permission_requests_count"("school_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_permission_audit_stats"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_permission_audit_stats"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_permission_audit_stats"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_promotion_preview"("student_ids" "uuid"[], "target_class_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_promotion_preview"("student_ids" "uuid"[], "target_class_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_promotion_preview"("student_ids" "uuid"[], "target_class_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_staff_roles"("staff_user_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_staff_roles"("staff_user_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_staff_roles"("staff_user_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_student_billing_summary"("school_id_param" "uuid", "class_id_param" "uuid", "term_id_param" "uuid", "session_id_param" "uuid", "date_from_param" "date", "date_to_param" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_billing_summary"("school_id_param" "uuid", "class_id_param" "uuid", "term_id_param" "uuid", "session_id_param" "uuid", "date_from_param" "date", "date_to_param" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_billing_summary"("school_id_param" "uuid", "class_id_param" "uuid", "term_id_param" "uuid", "session_id_param" "uuid", "date_from_param" "date", "date_to_param" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_custom_permissions_enabled"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_custom_permissions_enabled"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_custom_permissions_enabled"("_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_events"("user_id" "uuid", "start_date" "date", "end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_events"("user_id" "uuid", "start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_events"("user_id" "uuid", "start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permission_audit"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permission_audit"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permission_audit"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_schools"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_schools"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_schools"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_vehicle_assistant_assignments"("school_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_vehicle_assistant_assignments"("school_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_vehicle_assistant_assignments"("school_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_vehicle_assistants"("school_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_vehicle_assistants"("school_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_vehicle_assistants"("school_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_staff_role_creation"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_staff_role_creation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_staff_role_creation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_access"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_access"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_access"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("_user_id" "uuid", "_module" "text", "_operation" "public"."crud_operation", "_resource" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_current_user_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_current_user_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_user_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_teacher_assigned_to_class"("_user_id" "uuid", "_class_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_teacher_assigned_to_class"("_user_id" "uuid", "_class_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_teacher_assigned_to_class"("_user_id" "uuid", "_class_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_bulk_permission_change"("p_user_id" "uuid", "p_action" "text", "p_permission_count" integer, "p_template_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_bulk_permission_change"("p_user_id" "uuid", "p_action" "text", "p_permission_count" integer, "p_template_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_bulk_permission_change"("p_user_id" "uuid", "p_action" "text", "p_permission_count" integer, "p_template_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_permission_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_permission_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_permission_change"() TO "service_role";



GRANT ALL ON PROCEDURE "public"."log_promotion"(IN "student_id" "uuid", IN "msg" "text") TO "anon";
GRANT ALL ON PROCEDURE "public"."log_promotion"(IN "student_id" "uuid", IN "msg" "text") TO "authenticated";
GRANT ALL ON PROCEDURE "public"."log_promotion"(IN "student_id" "uuid", IN "msg" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_student_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_student_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_student_status_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."move_to_next_term"("_school_id" "uuid", "_current_term_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."move_to_next_term"("_school_id" "uuid", "_current_term_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_to_next_term"("_school_id" "uuid", "_current_term_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."promote_students_sequential"("student_ids" "uuid"[], "effective_date" "date", "reason" "text", "notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."promote_students_sequential"("student_ids" "uuid"[], "effective_date" "date", "reason" "text", "notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_students_sequential"("student_ids" "uuid"[], "effective_date" "date", "reason" "text", "notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."promote_students_to_class"("student_ids" "uuid"[], "target_class_id" "uuid", "target_session_id" "uuid", "target_term_id" "uuid", "reason" "text", "notes" "text", "effective_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."promote_students_to_class"("student_ids" "uuid"[], "target_class_id" "uuid", "target_session_id" "uuid", "target_term_id" "uuid", "reason" "text", "notes" "text", "effective_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_students_to_class"("student_ids" "uuid"[], "target_class_id" "uuid", "target_session_id" "uuid", "target_term_id" "uuid", "reason" "text", "notes" "text", "effective_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_current_session"("_school_id" "uuid", "_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_current_session"("_school_id" "uuid", "_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_current_session"("_school_id" "uuid", "_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_current_term"("_school_id" "uuid", "_term_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_current_term"("_school_id" "uuid", "_term_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_current_term"("_school_id" "uuid", "_term_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_emergency_contact_school_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_emergency_contact_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_emergency_contact_school_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_fee_account_school_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_fee_account_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_fee_account_school_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_fee_tx_defaults"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_fee_tx_defaults"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_fee_tx_defaults"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_parent_link_school_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_parent_link_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_parent_link_school_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_parent_links_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_parent_links_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_parent_links_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_parent_school_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_parent_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_parent_school_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_session_sequence_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_session_sequence_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_session_sequence_order"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_teacher_school_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_teacher_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_teacher_school_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."setup_superadmin_after_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."setup_superadmin_after_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."setup_superadmin_after_signup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_asset_quantity_on_txn"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_asset_quantity_on_txn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_asset_quantity_on_txn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_account_balance"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_account_balance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_account_balance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_deduction_types_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_deduction_types_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_deduction_types_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_driver_ride_history_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_driver_ride_history_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_driver_ride_history_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_drivers_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_drivers_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_drivers_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_library_book_availability"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_library_book_availability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_library_book_availability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_tips_state_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_tips_state_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_tips_state_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_loan_application"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_loan_application"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_loan_application"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_policy_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_policy_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_policy_assignment"() TO "service_role";



GRANT ALL ON TABLE "public"."academic_sessions" TO "anon";
GRANT ALL ON TABLE "public"."academic_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."academic_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."adjustments" TO "anon";
GRANT ALL ON TABLE "public"."adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_publications" TO "anon";
GRANT ALL ON TABLE "public"."assessment_publications" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_publications" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_results" TO "anon";
GRANT ALL ON TABLE "public"."assessment_results" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_results" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_types" TO "anon";
GRANT ALL ON TABLE "public"."assessment_types" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_types" TO "service_role";



GRANT ALL ON TABLE "public"."asset_assignments" TO "anon";
GRANT ALL ON TABLE "public"."asset_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."asset_categories" TO "anon";
GRANT ALL ON TABLE "public"."asset_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_categories" TO "service_role";



GRANT ALL ON TABLE "public"."asset_depreciation" TO "anon";
GRANT ALL ON TABLE "public"."asset_depreciation" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_depreciation" TO "service_role";



GRANT ALL ON TABLE "public"."asset_maintenance" TO "anon";
GRANT ALL ON TABLE "public"."asset_maintenance" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_maintenance" TO "service_role";



GRANT ALL ON TABLE "public"."asset_movements" TO "anon";
GRANT ALL ON TABLE "public"."asset_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_movements" TO "service_role";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_sessions" TO "anon";
GRANT ALL ON TABLE "public"."attendance_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."bill_items" TO "anon";
GRANT ALL ON TABLE "public"."bill_items" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_items" TO "service_role";



GRANT ALL ON TABLE "public"."bills" TO "anon";
GRANT ALL ON TABLE "public"."bills" TO "authenticated";
GRANT ALL ON TABLE "public"."bills" TO "service_role";



GRANT ALL ON TABLE "public"."borrowing_transactions" TO "anon";
GRANT ALL ON TABLE "public"."borrowing_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."borrowing_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_events" TO "anon";
GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT ALL ON TABLE "public"."class_subjects" TO "anon";
GRANT ALL ON TABLE "public"."class_subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."class_subjects" TO "service_role";



GRANT ALL ON TABLE "public"."class_teacher_assignments" TO "anon";
GRANT ALL ON TABLE "public"."class_teacher_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."class_teacher_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "anon";
GRANT ALL ON TABLE "public"."classes" TO "authenticated";
GRANT ALL ON TABLE "public"."classes" TO "service_role";



GRANT ALL ON TABLE "public"."enrollments" TO "anon";
GRANT ALL ON TABLE "public"."enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."classes_with_counts" TO "anon";
GRANT ALL ON TABLE "public"."classes_with_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."classes_with_counts" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."driver_ride_history" TO "anon";
GRANT ALL ON TABLE "public"."driver_ride_history" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_ride_history" TO "service_role";



GRANT ALL ON TABLE "public"."drivers" TO "anon";
GRANT ALL ON TABLE "public"."drivers" TO "authenticated";
GRANT ALL ON TABLE "public"."drivers" TO "service_role";



GRANT ALL ON TABLE "public"."emergency_contacts" TO "anon";
GRANT ALL ON TABLE "public"."emergency_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."emergency_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."event_recipients" TO "anon";
GRANT ALL ON TABLE "public"."event_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."event_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."exam_results" TO "anon";
GRANT ALL ON TABLE "public"."exam_results" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_results" TO "service_role";



GRANT ALL ON TABLE "public"."exams" TO "anon";
GRANT ALL ON TABLE "public"."exams" TO "authenticated";
GRANT ALL ON TABLE "public"."exams" TO "service_role";



GRANT ALL ON TABLE "public"."fee_accounts" TO "anon";
GRANT ALL ON TABLE "public"."fee_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."fee_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."fee_transactions" TO "anon";
GRANT ALL ON TABLE "public"."fee_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."fee_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."fixed_assets" TO "anon";
GRANT ALL ON TABLE "public"."fixed_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."fixed_assets" TO "service_role";



GRANT ALL ON TABLE "public"."grading_policies" TO "anon";
GRANT ALL ON TABLE "public"."grading_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."grading_policies" TO "service_role";



GRANT ALL ON TABLE "public"."grading_policy_grades" TO "anon";
GRANT ALL ON TABLE "public"."grading_policy_grades" TO "authenticated";
GRANT ALL ON TABLE "public"."grading_policy_grades" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "anon";
GRANT ALL ON TABLE "public"."group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."group_members" TO "service_role";



GRANT ALL ON TABLE "public"."group_message_permissions" TO "anon";
GRANT ALL ON TABLE "public"."group_message_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."group_message_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."group_reads" TO "anon";
GRANT ALL ON TABLE "public"."group_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."group_reads" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_borrowing_transactions" TO "anon";
GRANT ALL ON TABLE "public"."inventory_borrowing_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_borrowing_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_borrower_history" TO "anon";
GRANT ALL ON TABLE "public"."inventory_borrower_history" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_borrower_history" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_condition_report" TO "anon";
GRANT ALL ON TABLE "public"."inventory_condition_report" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_condition_report" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_transactions" TO "anon";
GRANT ALL ON TABLE "public"."inventory_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_current_stock" TO "anon";
GRANT ALL ON TABLE "public"."inventory_current_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_current_stock" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_outstanding_loans" TO "anon";
GRANT ALL ON TABLE "public"."inventory_outstanding_loans" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_outstanding_loans" TO "service_role";



GRANT ALL ON TABLE "public"."library_books" TO "anon";
GRANT ALL ON TABLE "public"."library_books" TO "authenticated";
GRANT ALL ON TABLE "public"."library_books" TO "service_role";



GRANT ALL ON TABLE "public"."library_categories" TO "anon";
GRANT ALL ON TABLE "public"."library_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."library_categories" TO "service_role";



GRANT ALL ON TABLE "public"."library_transactions" TO "anon";
GRANT ALL ON TABLE "public"."library_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."library_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."loans" TO "anon";
GRANT ALL ON TABLE "public"."loans" TO "authenticated";
GRANT ALL ON TABLE "public"."loans" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notification_logs" TO "anon";
GRANT ALL ON TABLE "public"."notification_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_logs" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."parent_student_links" TO "anon";
GRANT ALL ON TABLE "public"."parent_student_links" TO "authenticated";
GRANT ALL ON TABLE "public"."parent_student_links" TO "service_role";



GRANT ALL ON TABLE "public"."parents" TO "anon";
GRANT ALL ON TABLE "public"."parents" TO "authenticated";
GRANT ALL ON TABLE "public"."parents" TO "service_role";



GRANT ALL ON TABLE "public"."payment_batches" TO "anon";
GRANT ALL ON TABLE "public"."payment_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_batches" TO "service_role";



GRANT ALL ON TABLE "public"."payment_methods" TO "anon";
GRANT ALL ON TABLE "public"."payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_methods" TO "service_role";



GRANT ALL ON TABLE "public"."payment_plans" TO "anon";
GRANT ALL ON TABLE "public"."payment_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_plans" TO "service_role";



GRANT ALL ON TABLE "public"."payment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."payment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_allowances" TO "anon";
GRANT ALL ON TABLE "public"."payroll_allowances" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_allowances" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_component_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."payroll_component_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_component_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_deductions" TO "anon";
GRANT ALL ON TABLE "public"."payroll_deductions" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_deductions" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_entries" TO "anon";
GRANT ALL ON TABLE "public"."payroll_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_entries" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_periods" TO "anon";
GRANT ALL ON TABLE "public"."payroll_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_periods" TO "service_role";



GRANT ALL ON TABLE "public"."payslips" TO "anon";
GRANT ALL ON TABLE "public"."payslips" TO "authenticated";
GRANT ALL ON TABLE "public"."payslips" TO "service_role";



GRANT ALL ON TABLE "public"."permission_requests" TO "anon";
GRANT ALL ON TABLE "public"."permission_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_requests" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."policy_assignments" TO "anon";
GRANT ALL ON TABLE "public"."policy_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."policy_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."promotion_logs" TO "anon";
GRANT ALL ON TABLE "public"."promotion_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."promotion_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."promotion_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."promotion_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."promotion_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."school_content" TO "anon";
GRANT ALL ON TABLE "public"."school_content" TO "authenticated";
GRANT ALL ON TABLE "public"."school_content" TO "service_role";



GRANT ALL ON TABLE "public"."schools" TO "anon";
GRANT ALL ON TABLE "public"."schools" TO "authenticated";
GRANT ALL ON TABLE "public"."schools" TO "service_role";



GRANT ALL ON TABLE "public"."session_attendance" TO "anon";
GRANT ALL ON TABLE "public"."session_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."session_attendance" TO "service_role";



GRANT ALL ON TABLE "public"."staff" TO "anon";
GRANT ALL ON TABLE "public"."staff" TO "authenticated";
GRANT ALL ON TABLE "public"."staff" TO "service_role";



GRANT ALL ON TABLE "public"."staff_assignments" TO "anon";
GRANT ALL ON TABLE "public"."staff_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."statutory_record_details" TO "anon";
GRANT ALL ON TABLE "public"."statutory_record_details" TO "authenticated";
GRANT ALL ON TABLE "public"."statutory_record_details" TO "service_role";



GRANT ALL ON TABLE "public"."statutory_records" TO "anon";
GRANT ALL ON TABLE "public"."statutory_records" TO "authenticated";
GRANT ALL ON TABLE "public"."statutory_records" TO "service_role";



GRANT ALL ON TABLE "public"."streams" TO "anon";
GRANT ALL ON TABLE "public"."streams" TO "authenticated";
GRANT ALL ON TABLE "public"."streams" TO "service_role";



GRANT ALL ON TABLE "public"."student_history" TO "anon";
GRANT ALL ON TABLE "public"."student_history" TO "authenticated";
GRANT ALL ON TABLE "public"."student_history" TO "service_role";



GRANT ALL ON TABLE "public"."student_remark_templates" TO "anon";
GRANT ALL ON TABLE "public"."student_remark_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."student_remark_templates" TO "service_role";



GRANT ALL ON TABLE "public"."student_remarks" TO "anon";
GRANT ALL ON TABLE "public"."student_remarks" TO "authenticated";
GRANT ALL ON TABLE "public"."student_remarks" TO "service_role";



GRANT ALL ON TABLE "public"."student_status_history" TO "anon";
GRANT ALL ON TABLE "public"."student_status_history" TO "authenticated";
GRANT ALL ON TABLE "public"."student_status_history" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT ALL ON TABLE "public"."subjects" TO "anon";
GRANT ALL ON TABLE "public"."subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."subjects" TO "service_role";



GRANT ALL ON TABLE "public"."subjects_departments" TO "anon";
GRANT ALL ON TABLE "public"."subjects_departments" TO "authenticated";
GRANT ALL ON TABLE "public"."subjects_departments" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_assignments" TO "anon";
GRANT ALL ON TABLE "public"."teacher_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."teachers" TO "anon";
GRANT ALL ON TABLE "public"."teachers" TO "authenticated";
GRANT ALL ON TABLE "public"."teachers" TO "service_role";



GRANT ALL ON TABLE "public"."terms" TO "anon";
GRANT ALL ON TABLE "public"."terms" TO "authenticated";
GRANT ALL ON TABLE "public"."terms" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_entries" TO "anon";
GRANT ALL ON TABLE "public"."timetable_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_entries" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_periods" TO "anon";
GRANT ALL ON TABLE "public"."timetable_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_periods" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_rooms" TO "anon";
GRANT ALL ON TABLE "public"."timetable_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_subject_requirements" TO "anon";
GRANT ALL ON TABLE "public"."timetable_subject_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_subject_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_teacher_absences" TO "anon";
GRANT ALL ON TABLE "public"."timetable_teacher_absences" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_teacher_absences" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_teacher_availability" TO "anon";
GRANT ALL ON TABLE "public"."timetable_teacher_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_teacher_availability" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_templates" TO "anon";
GRANT ALL ON TABLE "public"."timetable_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_templates" TO "service_role";



GRANT ALL ON TABLE "public"."timetables" TO "anon";
GRANT ALL ON TABLE "public"."timetables" TO "authenticated";
GRANT ALL ON TABLE "public"."timetables" TO "service_role";



GRANT ALL ON TABLE "public"."tip_analytics" TO "anon";
GRANT ALL ON TABLE "public"."tip_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."tip_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."transport_billing" TO "anon";
GRANT ALL ON TABLE "public"."transport_billing" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_billing" TO "service_role";



GRANT ALL ON TABLE "public"."transport_billing_invoices" TO "anon";
GRANT ALL ON TABLE "public"."transport_billing_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_billing_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."transport_billing_payments" TO "anon";
GRANT ALL ON TABLE "public"."transport_billing_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_billing_payments" TO "service_role";



GRANT ALL ON TABLE "public"."transport_billing_rates" TO "anon";
GRANT ALL ON TABLE "public"."transport_billing_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_billing_rates" TO "service_role";



GRANT ALL ON TABLE "public"."transport_bus_assignments" TO "anon";
GRANT ALL ON TABLE "public"."transport_bus_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_bus_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."transport_driver_assignments" TO "anon";
GRANT ALL ON TABLE "public"."transport_driver_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_driver_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."transport_routes" TO "anon";
GRANT ALL ON TABLE "public"."transport_routes" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_routes" TO "service_role";



GRANT ALL ON TABLE "public"."transport_stops" TO "anon";
GRANT ALL ON TABLE "public"."transport_stops" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_stops" TO "service_role";



GRANT ALL ON TABLE "public"."transport_student_assignments" TO "anon";
GRANT ALL ON TABLE "public"."transport_student_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_student_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."transport_vehicle_assistant_assignments" TO "anon";
GRANT ALL ON TABLE "public"."transport_vehicle_assistant_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_vehicle_assistant_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."transport_vehicle_credentials" TO "anon";
GRANT ALL ON TABLE "public"."transport_vehicle_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_vehicle_credentials" TO "service_role";



GRANT ALL ON TABLE "public"."transport_vehicles" TO "anon";
GRANT ALL ON TABLE "public"."transport_vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."user_events" TO "anon";
GRANT ALL ON TABLE "public"."user_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_events" TO "service_role";



GRANT ALL ON TABLE "public"."user_permissions" TO "anon";
GRANT ALL ON TABLE "public"."user_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."user_permissions_audit" TO "anon";
GRANT ALL ON TABLE "public"."user_permissions_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permissions_audit" TO "service_role";



GRANT ALL ON TABLE "public"."user_push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_push_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_push_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_push_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_tips_state" TO "anon";
GRANT ALL ON TABLE "public"."user_tips_state" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tips_state" TO "service_role";



GRANT ALL ON TABLE "public"."vw_academic_structure" TO "anon";
GRANT ALL ON TABLE "public"."vw_academic_structure" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_academic_structure" TO "service_role";



GRANT ALL ON TABLE "public"."vw_vehicle_assistants" TO "anon";
GRANT ALL ON TABLE "public"."vw_vehicle_assistants" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_vehicle_assistants" TO "service_role";



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






RESET ALL;
