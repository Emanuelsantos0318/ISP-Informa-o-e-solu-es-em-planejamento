export type ProfileRole =
  | "super_admin"
  | "admin"
  | "stock_manager"
  | "operator"
  | "purchasing_approver"
  | "viewer";

export type UserProfile = {
  user_id: string;
  company_id: string;
  unit_id: string | null;
  full_name: string;
  role: ProfileRole;
  status: "active" | "inactive";
  avatar_path: string | null;
  theme_preference: "light" | "dark";
};
