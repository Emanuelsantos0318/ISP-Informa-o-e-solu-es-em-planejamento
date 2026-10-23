export type ProfileRole =
  "admin" | "stock_manager" | "operator" | "purchasing_approver" | "viewer";

export type UserProfile = {
  user_id: string;
  company_id: string;
  unit_id: string | null;
  full_name: string;
  role: ProfileRole;
  status: "active" | "inactive";
};
