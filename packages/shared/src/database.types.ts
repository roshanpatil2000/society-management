export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_label: string;
          after: Json | null;
          before: Json | null;
          created_at: string;
          id: number;
          row_id: string | null;
          society_id: string | null;
          table_name: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_label: string;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          id?: never;
          row_id?: string | null;
          society_id?: string | null;
          table_name: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_label?: string;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          id?: never;
          row_id?: string | null;
          society_id?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
      invite: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          email: string;
          expires_at: string;
          flat_id: string | null;
          full_name: string | null;
          id: string;
          kind: string;
          last_sent_at: string;
          role_ids: string[];
          society_id: string;
          status: string;
          token: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          email: string;
          expires_at?: string;
          flat_id?: string | null;
          full_name?: string | null;
          id?: string;
          kind?: string;
          last_sent_at?: string;
          role_ids?: string[];
          society_id: string;
          status?: string;
          token?: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          email?: string;
          expires_at?: string;
          flat_id?: string | null;
          full_name?: string | null;
          id?: string;
          kind?: string;
          last_sent_at?: string;
          role_ids?: string[];
          society_id?: string;
          status?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invite_accepted_by_fkey';
            columns: ['accepted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invite_society_id_fkey';
            columns: ['society_id'];
            isOneToOne: false;
            referencedRelation: 'society';
            referencedColumns: ['id'];
          },
        ];
      };
      job_run: {
        Row: {
          error: string | null;
          finished_at: string | null;
          id: number;
          job: string;
          society_id: string | null;
          started_at: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          error?: string | null;
          finished_at?: string | null;
          id?: never;
          job: string;
          society_id?: string | null;
          started_at?: string;
          status?: string;
        };
        Update: {
          error?: string | null;
          finished_at?: string | null;
          id?: never;
          job?: string;
          society_id?: string | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      membership: {
        Row: {
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          id: string;
          society_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          society_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          society_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'membership_society_id_fkey';
            columns: ['society_id'];
            isOneToOne: false;
            referencedRelation: 'society';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'membership_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      membership_role: {
        Row: {
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          id: string;
          membership_id: string;
          role_id: string;
          society_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          membership_id: string;
          role_id: string;
          society_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          membership_id?: string;
          role_id?: string;
          society_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'membership_role_society_id_membership_id_fkey';
            columns: ['society_id', 'membership_id'];
            isOneToOne: false;
            referencedRelation: 'membership';
            referencedColumns: ['society_id', 'id'];
          },
          {
            foreignKeyName: 'membership_role_society_id_membership_id_fkey';
            columns: ['society_id', 'membership_id'];
            isOneToOne: false;
            referencedRelation: 'my_memberships';
            referencedColumns: ['society_id', 'membership_id'];
          },
          {
            foreignKeyName: 'membership_role_society_id_role_id_fkey';
            columns: ['society_id', 'role_id'];
            isOneToOne: false;
            referencedRelation: 'role';
            referencedColumns: ['society_id', 'id'];
          },
        ];
      };
      permission: {
        Row: {
          description: string;
          key: string;
          module: string;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          key: string;
          module: string;
        };
        Update: {
          description?: string;
          key?: string;
          module?: string;
        };
        Relationships: [];
      };
      platform_admin: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_admin_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_config: {
        Row: {
          daily_email_cap: number;
          daily_sms_cap: number;
          email_per_address_daily: number;
          email_per_address_hourly: number;
          id: boolean;
          sms_enabled: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          daily_email_cap?: number;
          daily_sms_cap?: number;
          email_per_address_daily?: number;
          email_per_address_hourly?: number;
          id?: boolean;
          sms_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          daily_email_cap?: number;
          daily_sms_cap?: number;
          email_per_address_daily?: number;
          email_per_address_hourly?: number;
          id?: boolean;
          sms_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_key: string | null;
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          phone: string | null;
          updated_at: string;
          whatsapp_opt_in: boolean;
          whatsapp_opt_in_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          avatar_key?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          updated_at?: string;
          whatsapp_opt_in?: boolean;
          whatsapp_opt_in_at?: string | null;
        };
        Update: {
          avatar_key?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          updated_at?: string;
          whatsapp_opt_in?: boolean;
          whatsapp_opt_in_at?: string | null;
        };
        Relationships: [];
      };
      role: {
        Row: {
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          id: string;
          is_system: boolean;
          name: string;
          permissions: string[];
          society_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          permissions?: string[];
          society_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          permissions?: string[];
          society_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'role_society_id_fkey';
            columns: ['society_id'];
            isOneToOne: false;
            referencedRelation: 'society';
            referencedColumns: ['id'];
          },
        ];
      };
      role_preset: {
        Row: {
          description: string;
          name: string;
          permissions: string[];
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          name: string;
          permissions: string[];
          sort_order: number;
          updated_at?: string;
        };
        Update: {
          description?: string;
          name?: string;
          permissions?: string[];
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      setting_change: {
        Row: {
          approved_by: string | null;
          created_at: string;
          created_by: string | null;
          decided_at: string | null;
          decision_comment: string | null;
          deleted_at: string | null;
          id: string;
          key: string;
          new_value: NonNullable<Json>;
          old_value: Json | null;
          requested_by: string;
          society_id: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          decided_at?: string | null;
          decision_comment?: string | null;
          deleted_at?: string | null;
          id?: string;
          key: string;
          new_value: NonNullable<Json>;
          old_value?: Json | null;
          requested_by: string;
          society_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          decided_at?: string | null;
          decision_comment?: string | null;
          deleted_at?: string | null;
          id?: string;
          key?: string;
          new_value?: NonNullable<Json>;
          old_value?: Json | null;
          requested_by?: string;
          society_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'setting_change_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'setting_change_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'setting_change_society_id_fkey';
            columns: ['society_id'];
            isOneToOne: false;
            referencedRelation: 'society';
            referencedColumns: ['id'];
          },
        ];
      };
      society: {
        Row: {
          address: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          financial_year_start_month: number;
          gstin: string | null;
          id: string;
          locked_until: string | null;
          name: string;
          plan: string;
          quotas: NonNullable<Json>;
          registration_no: string | null;
          settings: NonNullable<Json>;
          status: string;
          timezone: string;
          trial_ends_at: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          financial_year_start_month?: number;
          gstin?: string | null;
          id?: string;
          locked_until?: string | null;
          name: string;
          plan?: string;
          quotas?: NonNullable<Json>;
          registration_no?: string | null;
          settings?: NonNullable<Json>;
          status?: string;
          timezone?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          financial_year_start_month?: number;
          gstin?: string | null;
          id?: string;
          locked_until?: string | null;
          name?: string;
          plan?: string;
          quotas?: NonNullable<Json>;
          registration_no?: string | null;
          settings?: NonNullable<Json>;
          status?: string;
          timezone?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      society_usage: {
        Row: {
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          emails_sent: number;
          id: string;
          invites_sent: number;
          month: string;
          sms_sent: number;
          society_id: string;
          storage_bytes: number;
          updated_at: string;
          whatsapp_sent: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          emails_sent?: number;
          id?: string;
          invites_sent?: number;
          month: string;
          sms_sent?: number;
          society_id: string;
          storage_bytes?: number;
          updated_at?: string;
          whatsapp_sent?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          emails_sent?: number;
          id?: string;
          invites_sent?: number;
          month?: string;
          sms_sent?: number;
          society_id?: string;
          storage_bytes?: number;
          updated_at?: string;
          whatsapp_sent?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'society_usage_society_id_fkey';
            columns: ['society_id'];
            isOneToOne: false;
            referencedRelation: 'society';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      my_memberships: {
        Row: {
          membership_id: string;
          role_names: string[] | null;
          society_id: string;
          society_name: string;
          society_status: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: 'membership_society_id_fkey';
            columns: ['society_id'];
            isOneToOne: false;
            referencedRelation: 'society';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string };
      admin_add_committee_begin: {
        Args: { p_actor: string; p_committee: Json; p_society_id: string };
        Returns: Json;
      };
      admin_find_users: {
        Args: { p_emails: string[] };
        Returns: {
          email: string;
          user_id: string;
        }[];
      };
      admin_onboard_abort: {
        Args: { p_actor: string; p_invite_ids: string[]; p_society_id: string };
        Returns: undefined;
      };
      admin_onboard_begin: {
        Args: { p_actor: string; p_committee: Json; p_society: Json };
        Returns: Json;
      };
      admin_onboard_finish: {
        Args: {
          p_accepts: Json;
          p_actor: string;
          p_final_status?: string;
          p_society_id: string;
          p_trial_ends_at?: string;
        };
        Returns: Json;
      };
      approve_setting_change: {
        Args: { p_change_id: string; p_comment?: string; p_decision: string };
        Returns: undefined;
      };
      assign_roles: { Args: { p_membership_id: string; p_role_ids: string[] }; Returns: undefined };
      create_invite: {
        Args: {
          p_email: string;
          p_flat_id?: string;
          p_full_name?: string;
          p_role_ids: string[];
          p_society_id: string;
        };
        Returns: {
          expires_at: string;
          invite_id: string;
          token: string;
        }[];
      };
      create_role: {
        Args: { p_name: string; p_permissions: string[]; p_society_id: string };
        Returns: string;
      };
      email_hook_check: { Args: { p_action: string; p_email: string }; Returns: Json };
      get_my_permissions: { Args: { p_society_id: string }; Returns: string[] };
      my_pending_invites: {
        Args: Record<PropertyKey, never>;
        Returns: {
          expires_at: string;
          invite_id: string;
          kind: string;
          role_names: string[];
          society_id: string;
          society_name: string;
          token: string;
        }[];
      };
      platform_set_quotas: {
        Args: { p_plan?: string; p_quotas?: Json; p_society_id: string };
        Returns: Json;
      };
      platform_set_society_status: {
        Args: { p_society_id: string; p_status: string; p_trial_ends_at?: string };
        Returns: undefined;
      };
      request_setting_change: {
        Args: { p_key: string; p_society_id: string; p_value: Json };
        Returns: string;
      };
      resend_invite: {
        Args: { p_invite_id: string };
        Returns: {
          expires_at: string;
          invite_id: string;
          token: string;
        }[];
      };
      revoke_invite: { Args: { p_invite_id: string }; Returns: undefined };
      update_role: {
        Args: { p_name?: string; p_permissions?: string[]; p_role_id: string };
        Returns: undefined;
      };
      update_society_settings: { Args: { p_settings: Json; p_society_id: string }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
