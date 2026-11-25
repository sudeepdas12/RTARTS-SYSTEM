import { supabase, throwIfError } from "./database";

export interface CorporateDeclaration {
  id: string;
  declaration_code: string;
  company_id: string;
  declaration_type: "Dividend" | "Interest";
  sub_type?: string;
  fiscal_year: string;
  declaration_date: string;
  record_date?: string | null;
  payment_due_date?: string | null;
  rate_per_share: number;
  face_value: number;
  total_declared_amount: number;
  total_eligible_shares: number;
  status: "Draft" | "Active" | "Completed" | "Closed";
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  companies?: {
    id: string;
    company_name: string;
    company_code: string;
  } | null;
}

export interface DeclarationSummary {
  declaration_id: string;
  declaration_code: string;
  declaration_type: string;
  sub_type?: string;
  fiscal_year: string;
  declaration_date: string;
  record_date?: string;
  payment_due_date?: string;
  rate_per_share: number;
  total_declared_amount: number;
  total_payables_count: number;
  gross_amount: number;
  tax_amount: number;
  net_payable_amount: number;
  paid_amount: number;
  remaining_amount: number;
  failed_amount: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
  failed_count: number;
  batches_count: number;
  progress_percent: number;
  error?: string;
}

export const DeclarationService = {
  async getDeclarations(companyId?: string): Promise<CorporateDeclaration[]> {
    let query = (supabase as any)
      .from("corporate_declarations")
      .select("*, companies(id, company_name, company_code)")
      .order("created_at", { ascending: false });

    if (companyId && companyId !== "all") {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to fetch corporate declarations");
    return (data || []) as CorporateDeclaration[];
  },

  async getDeclarationById(id: string): Promise<CorporateDeclaration | null> {
    const { data, error } = await (supabase as any)
      .from("corporate_declarations")
      .select("*, companies(id, company_name, company_code)")
      .eq("id", id)
      .maybeSingle();

    throwIfError(error, `Failed to fetch declaration ${id}`);
    return data as CorporateDeclaration | null;
  },

  async createDeclaration(
    declaration: Partial<CorporateDeclaration>,
  ): Promise<CorporateDeclaration> {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Auto-generate declaration code if not provided
    const code =
      declaration.declaration_code ||
      `DEC-${(declaration.fiscal_year || "FY").replace("/", "-")}-${declaration.declaration_type === "Interest" ? "INT" : "DIV"}-${Math.floor(1000 + Math.random() * 9000)}`;

    const payload = {
      ...declaration,
      declaration_code: code,
      created_by: user?.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase as any)
      .from("corporate_declarations")
      .insert(payload)
      .select("*, companies(id, company_name, company_code)")
      .single();

    throwIfError(error, "Failed to create corporate declaration");
    return data as CorporateDeclaration;
  },

  async updateDeclaration(
    id: string,
    updates: Partial<CorporateDeclaration>,
  ): Promise<CorporateDeclaration> {
    const payload = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase as any)
      .from("corporate_declarations")
      .update(payload)
      .eq("id", id)
      .select("*, companies(id, company_name, company_code)")
      .single();

    throwIfError(error, `Failed to update declaration ${id}`);
    return data as CorporateDeclaration;
  },

  async deleteDeclaration(id: string): Promise<boolean> {
    const { error } = await (supabase as any).from("corporate_declarations").delete().eq("id", id);

    throwIfError(error, `Failed to delete declaration ${id}`);
    return true;
  },

  async getDeclarationSummary(id: string): Promise<DeclarationSummary> {
    const { data, error } = await (supabase as any).rpc("get_declaration_summary", {
      p_declaration_id: id,
    });

    throwIfError(error, `Failed to calculate summary for declaration ${id}`);
    return data as DeclarationSummary;
  },
};
