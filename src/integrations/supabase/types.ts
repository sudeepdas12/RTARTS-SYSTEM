export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          action_time: string
          id: string
          new_value: Json | null
          old_value: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          action_time?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          action_time?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          amount: number
          bank_account_no: string | null
          created_at: string
          description: string | null
          id: string
          is_reconciled: boolean
          matched_payable_id: string | null
          matched_payable_type: string | null
          reference: string | null
          transaction_date: string
          uploaded_by: string | null
        }
        Insert: {
          amount: number
          bank_account_no?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_reconciled?: boolean
          matched_payable_id?: string | null
          matched_payable_type?: string | null
          reference?: string | null
          transaction_date: string
          uploaded_by?: string | null
        }
        Update: {
          amount?: number
          bank_account_no?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_reconciled?: boolean
          matched_payable_id?: string | null
          matched_payable_type?: string | null
          reference?: string | null
          transaction_date?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          account_type: string | null
          address: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_name: string | null
          boid: string | null
          client_code: string
          client_id: string | null
          created_at: string
          created_by: string | null
          district: string | null
          email: string | null
          father_name: string | null
          full_name: string
          grandfather_name: string | null
          holder_type: Database["public"]["Enums"]["holder_type"] | null
          id: string
          municipality: string | null
          pan_or_citizenship: string | null
          phone: string | null
          province: string | null
          residency: Database["public"]["Enums"]["residency_type"] | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          account_type?: string | null
          address?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          boid?: string | null
          client_code: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          email?: string | null
          father_name?: string | null
          full_name: string
          grandfather_name?: string | null
          holder_type?: Database["public"]["Enums"]["holder_type"] | null
          id?: string
          municipality?: string | null
          pan_or_citizenship?: string | null
          phone?: string | null
          province?: string | null
          residency?: Database["public"]["Enums"]["residency_type"] | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          account_type?: string | null
          address?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          boid?: string | null
          client_code?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          email?: string | null
          father_name?: string | null
          full_name?: string
          grandfather_name?: string | null
          holder_type?: Database["public"]["Enums"]["holder_type"] | null
          id?: string
          municipality?: string | null
          pan_or_citizenship?: string | null
          phone?: string | null
          province?: string | null
          residency?: Database["public"]["Enums"]["residency_type"] | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: []
      }
      companies: {
        Row: {
          bank_account_no: string | null
          bank_name: string | null
          company_code: string
          company_name: string
          company_type: string | null
          coupon_rate: number | null
          created_at: string
          created_by: string | null
          debenture_rate: number | null
          dividend_rate: number | null
          face_value: number | null
          fiscal_year: string | null
          id: string
          interest_tax_status: Database["public"]["Enums"]["tax_status"] | null
          isin: string | null
          issue_size: number | null
          listed_date: string | null
          maturity_date: string | null
          pan_no: string | null
          registrar: string | null
          sector_type: Database["public"]["Enums"]["sector_type"] | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          bank_account_no?: string | null
          bank_name?: string | null
          company_code: string
          company_name: string
          company_type?: string | null
          coupon_rate?: number | null
          created_at?: string
          created_by?: string | null
          debenture_rate?: number | null
          dividend_rate?: number | null
          face_value?: number | null
          fiscal_year?: string | null
          id?: string
          interest_tax_status?: Database["public"]["Enums"]["tax_status"] | null
          isin?: string | null
          issue_size?: number | null
          listed_date?: string | null
          maturity_date?: string | null
          pan_no?: string | null
          registrar?: string | null
          sector_type?: Database["public"]["Enums"]["sector_type"] | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          bank_account_no?: string | null
          bank_name?: string | null
          company_code?: string
          company_name?: string
          company_type?: string | null
          coupon_rate?: number | null
          created_at?: string
          created_by?: string | null
          debenture_rate?: number | null
          dividend_rate?: number | null
          face_value?: number | null
          fiscal_year?: string | null
          id?: string
          interest_tax_status?: Database["public"]["Enums"]["tax_status"] | null
          isin?: string | null
          issue_size?: number | null
          listed_date?: string | null
          maturity_date?: string | null
          pan_no?: string | null
          registrar?: string | null
          sector_type?: Database["public"]["Enums"]["sector_type"] | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: []
      }
      dividend_payables: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          created_by: string | null
          dividend_rate: number | null
          fiscal_year: string | null
          gross_dividend: number
          id: string
          net_payable: number
          payment_date: string | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shares_held: number | null
          tax_amount: number
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          dividend_rate?: number | null
          fiscal_year?: string | null
          gross_dividend?: number
          id?: string
          net_payable?: number
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shares_held?: number | null
          tax_amount?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          dividend_rate?: number | null
          fiscal_year?: string | null
          gross_dividend?: number
          id?: string
          net_payable?: number
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shares_held?: number | null
          tax_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dividend_payables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividend_payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_years: {
        Row: {
          created_at: string
          end_date: string
          fiscal_year: string
          id: string
          is_active: boolean
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          fiscal_year: string
          id?: string
          is_active?: boolean
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          fiscal_year?: string
          id?: string
          is_active?: boolean
          start_date?: string
        }
        Relationships: []
      }
      iaf_allocations: {
        Row: {
          allocated_amount: number
          company_id: string | null
          created_at: string
          created_by: string | null
          fiscal_year: string
          id: string
          notes: string | null
          updated_at: string
          utilized_amount: number
        }
        Insert: {
          allocated_amount?: number
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_year: string
          id?: string
          notes?: string | null
          updated_at?: string
          utilized_amount?: number
        }
        Update: {
          allocated_amount?: number
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_year?: string
          id?: string
          notes?: string | null
          updated_at?: string
          utilized_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "iaf_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      interest_payables: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string
          fiscal_year: string | null
          gross_interest: number
          id: string
          instrument_ref: string | null
          net_payable: number
          payment_date: string | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          tax_amount: number
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          fiscal_year?: string | null
          gross_interest?: number
          id?: string
          instrument_ref?: string | null
          net_payable?: number
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          tax_amount?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          fiscal_year?: string | null
          gross_interest?: number
          id?: string
          instrument_ref?: string | null
          net_payable?: number
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          tax_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interest_payables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interest_payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_approvals: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json
          requested_by: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload: Json
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "finance_operator"
        | "reconciliation_officer"
        | "auditor"
        | "report_viewer"
        | "supervisor"
        | "operator"
        | "maker"
        | "checker"
        | "approver"
        | "read_only"
      approval_status: "Pending" | "Approved" | "Rejected"
      holder_type: "Natural Person - Public" | "Natural Person - Promoter" | "Legal Person" | "Mutual Fund" | "Foreign" | "Tax Exempt" | "Public" | "Promoter" | "Institution"
      payment_status: "Pending" | "Paid" | "Partial"
      record_status: "Active" | "Inactive"
      residency_type: "Resident" | "Non-Resident"
      sector_type: "Public" | "Private" | "Institution" | "Government" | "Other"
      tax_status: "Taxable" | "Exempted"
      verification_status: "Pending" | "Verified" | "Rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "finance_operator",
        "reconciliation_officer",
        "auditor",
        "report_viewer",
        "supervisor",
        "operator",
        "maker",
        "checker",
        "approver",
        "read_only",
      ],
      approval_status: ["Pending", "Approved", "Rejected"],
      holder_type: ["Public", "Promoter", "Institution"],
      payment_status: ["Pending", "Paid", "Partial"],
      record_status: ["Active", "Inactive"],
      residency_type: ["Resident", "Non-Resident"],
      sector_type: ["Public", "Private", "Institution", "Government", "Other"],
      tax_status: ["Taxable", "Exempted"],
      verification_status: ["Pending", "Verified", "Rejected"],
    },
  },
} as const
