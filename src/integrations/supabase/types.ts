export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_usage: {
        Row: {
          count: number;
          id: string;
          organization_id: string;
          usage_date: string;
          user_id: string | null;
        };
        Insert: {
          count?: number;
          id?: string;
          organization_id: string;
          usage_date?: string;
          user_id?: string | null;
        };
        Update: {
          count?: number;
          id?: string;
          organization_id?: string;
          usage_date?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          organization_id: string | null;
          target_id: string | null;
          target_type: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          organization_id?: string | null;
          target_id?: string | null;
          target_type?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          organization_id?: string | null;
          target_id?: string | null;
          target_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      boards_exams: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "boards_exams_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      classes: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "classes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_papers: {
        Row: {
          ai_source: string | null;
          answer_key_pdf_path: string | null;
          config: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          omr_pdf_path: string | null;
          organization_id: string;
          paper_pdf_path: string | null;
          questions: Json;
          syllabus_id: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          ai_source?: string | null;
          answer_key_pdf_path?: string | null;
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          omr_pdf_path?: string | null;
          organization_id: string;
          paper_pdf_path?: string | null;
          questions?: Json;
          syllabus_id?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          ai_source?: string | null;
          answer_key_pdf_path?: string | null;
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          omr_pdf_path?: string | null;
          organization_id?: string;
          paper_pdf_path?: string | null;
          questions?: Json;
          syllabus_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_papers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_papers_syllabus_id_fkey";
            columns: ["syllabus_id"];
            isOneToOne: false;
            referencedRelation: "uploaded_syllabi";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_transactions: {
        Row: {
          actor_user_id: string | null;
          balance_after: number;
          created_at: string;
          delta: number;
          id: string;
          organization_id: string;
          reason: string;
        };
        Insert: {
          actor_user_id?: string | null;
          balance_after: number;
          created_at?: string;
          delta: number;
          id?: string;
          organization_id: string;
          reason?: string;
        };
        Update: {
          actor_user_id?: string | null;
          balance_after?: number;
          created_at?: string;
          delta?: number;
          id?: string;
          organization_id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_transactions_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_transactions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_results: {
        Row: {
          created_at: string;
          exam_id: string;
          id: string;
          notes: string | null;
          obtained_marks: number | null;
          organization_id: string;
          published_at: string | null;
          status: Database["public"]["Enums"]["exam_result_status"];
          student_count: number | null;
          total_marks: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          exam_id: string;
          id?: string;
          notes?: string | null;
          obtained_marks?: number | null;
          organization_id: string;
          published_at?: string | null;
          status?: Database["public"]["Enums"]["exam_result_status"];
          student_count?: number | null;
          total_marks?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          exam_id?: string;
          id?: string;
          notes?: string | null;
          obtained_marks?: number | null;
          organization_id?: string;
          published_at?: string | null;
          status?: Database["public"]["Enums"]["exam_result_status"];
          student_count?: number | null;
          total_marks?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exam_results_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_results_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      exams: {
        Row: {
          created_at: string;
          created_by: string | null;
          exam_id: string;
          exam_name: string;
          id: string;
          organization_id: string;
          paper_id: string | null;
          requires_omr: boolean;
          template_type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          exam_id: string;
          exam_name: string;
          id?: string;
          organization_id: string;
          paper_id?: string | null;
          requires_omr?: boolean;
          template_type?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          exam_id?: string;
          exam_name?: string;
          id?: string;
          organization_id?: string;
          paper_id?: string | null;
          requires_omr?: boolean;
          template_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exams_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_paper_id_fkey";
            columns: ["paper_id"];
            isOneToOne: false;
            referencedRelation: "generated_papers";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          address: string | null;
          ai_daily_quota: number;
          paper_credit_balance: number | null;
          paper_daily_limit: number;
          created_at: string;
          expiry_date: string | null;
          id: string;
          logo_url: string | null;
          name: string;
          plan: Database["public"]["Enums"]["org_plan"];
          status: Database["public"]["Enums"]["org_status"];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          ai_daily_quota?: number;
          paper_credit_balance?: number | null;
          paper_daily_limit?: number;
          created_at?: string;
          expiry_date?: string | null;
          id?: string;
          logo_url?: string | null;
          name: string;
          plan?: Database["public"]["Enums"]["org_plan"];
          status?: Database["public"]["Enums"]["org_status"];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          ai_daily_quota?: number;
          paper_credit_balance?: number | null;
          paper_daily_limit?: number;
          created_at?: string;
          expiry_date?: string | null;
          id?: string;
          logo_url?: string | null;
          name?: string;
          plan?: Database["public"]["Enums"]["org_plan"];
          status?: Database["public"]["Enums"]["org_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value?: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          must_change_password: boolean;
          organization_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string;
          id: string;
          is_active?: boolean;
          must_change_password?: boolean;
          organization_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          must_change_password?: boolean;
          organization_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      subjects: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subjects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      templates: {
        Row: {
          config: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      uploaded_syllabi: {
        Row: {
          chapters: Json;
          created_at: string;
          extracted_text: string | null;
          filename: string;
          id: string;
          keywords: Json;
          organization_id: string;
          subject: string;
          storage_path: string;
          uploaded_by: string | null;
        };
        Insert: {
          chapters?: Json;
          created_at?: string;
          extracted_text?: string | null;
          filename: string;
          id?: string;
          keywords?: Json;
          organization_id: string;
          subject?: string;
          storage_path: string;
          uploaded_by?: string | null;
        };
        Update: {
          chapters?: Json;
          created_at?: string;
          extracted_text?: string | null;
          filename?: string;
          id?: string;
          keywords?: Json;
          organization_id?: string;
          subject?: string;
          storage_path?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "uploaded_syllabi_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_org_id: { Args: never; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_super_admin: { Args: never; Returns: boolean };
      release_paper_generation_credit: { Args: { p_organization_id: string }; Returns: undefined };
      reserve_paper_generation_credit: { Args: { p_organization_id: string }; Returns: boolean };
      set_credits: {
        Args: {
          p_organization_id: string;
          p_credits: number | null;
          p_reason?: string;
          p_actor_user_id?: string;
        };
        Returns: { new_balance: number | null }[];
      };
      super_admin_exists: { Args: never; Returns: boolean };
      top_up_credits: {
        Args: {
          p_organization_id: string;
          p_delta: number;
          p_reason?: string;
          p_actor_user_id?: string;
        };
        Returns: { new_balance: number }[];
      };
    };
    Enums: {
      app_role: "super_admin" | "org_admin";
      exam_result_status: "pending" | "processing" | "verified" | "published";
      org_plan: "free" | "basic" | "pro";
      org_status: "active" | "inactive" | "suspended";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "org_admin"],
      exam_result_status: ["pending", "processing", "verified", "published"],
      org_plan: ["free", "basic", "pro"],
      org_status: ["active", "inactive", "suspended"],
    },
  },
} as const;
