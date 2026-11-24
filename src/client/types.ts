/**
 * Definições estritas de tipos TypeScript do Frontend — Gestor de Barbearia (NOVA RUNTIME)
 */

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type AppointmentSource = 'admin' | 'public';
export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'other';
export type ThemeMode = 'dark' | 'light';

export interface Settings {
  shop_name?: string;
  shop_company?: string;
  shop_phone?: string;
  shop_whatsapp?: string;
  shop_address?: string;
  shop_instagram?: string;
  public_booking?: string;
  slot_interval?: string | number;
  min_advance_minutes?: string | number;
  max_advance_days?: string | number;
  whatsapp_message_confirmation?: string;
  whatsapp_message_reminder?: string;
  whatsapp_message_cancellation?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface BarberHours {
  id?: number;
  barber_id?: number;
  weekday: number;
  is_working: number | boolean;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

export interface Barber {
  id: number;
  shop_id?: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  color?: string | null;
  commission?: number;
  active?: number | boolean;
  specialties?: string;
  bio?: string;
  rating?: number;
  avatar_url?: string;
  hours?: BarberHours[];
  created_at?: string;
}

export interface Service {
  id: number;
  shop_id?: number;
  name: string;
  price: number;
  duration_min: number;
  description?: string | null;
  category?: string;
  active?: number | boolean;
  created_at?: string;
}

export interface Client {
  id: number;
  shop_id?: number;
  name: string;
  phone: string;
  email?: string | null;
  birth_date?: string | null;
  notes?: string | null;
  appointments_total?: number;
  last_visit?: string | null;
  created_at?: string;
}

export interface ClientWithHistory extends Client {
  history?: Appointment[];
}

export interface BusinessHours {
  weekday: number;
  is_open: number | boolean;
  open_time: string;
  close_time: string;
  break_start: string | null;
  break_end: string | null;
}

export interface Closure {
  id: number;
  date: string;
  reason: string | null;
}

export interface Appointment {
  id: number;
  shop_id?: number;
  client_id: number;
  barber_id: number;
  service_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  price: number;
  payment_method?: PaymentMethod | string | null;
  notes?: string | null;
  source?: AppointmentSource;
  cancel_token?: string | null;
  cancellation_reason?: string | null;
  created_at?: string;
  updated_at?: string | null;
  client_name: string;
  client_phone?: string;
  client_email?: string | null;
  barber_name: string;
  barber_color?: string | null;
  service_name?: string | null;
  service_duration?: number | null;
}

export interface DashboardOccupancy {
  barbers: number;
  available_minutes: number;
  booked_minutes: number;
  rate: number | null;
}

export interface DashboardRankItem {
  id?: number;
  barber_id?: number;
  service_id?: number;
  name: string;
  total: number;
  completed?: number;
  revenue: number;
  realized?: number;
}

export interface DashboardRecentActivity {
  id: number;
  date: string;
  start_time: string;
  end_time?: string;
  status: AppointmentStatus;
  price: number;
  client_name: string;
  barber_name: string;
  service_name?: string | null;
  updated_at?: string | null;
  created_at?: string;
}

export interface DashboardResponse {
  date: string;
  today: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    no_show: number;
    revenue_expected: number;
    revenue_realized: number;
    appointments: Appointment[];
    occupancy: DashboardOccupancy;
  };
  week: {
    start: string;
    end: string;
    total: number;
    completed: number;
    revenue_realized: number;
    revenue_expected: number;
  };
  month: {
    start: string;
    end: string;
    total: number;
    completed: number;
    revenue_realized: number;
    revenue_expected: number;
    new_clients: number;
    average_ticket: number;
  };
  upcoming: Appointment[];
  recent_activity?: DashboardRecentActivity[];
  clients_total?: number;
  top_services: DashboardRankItem[];
  top_barbers: DashboardRankItem[];
  shop_name: string;
}

export interface ReportDailyRow {
  date: string;
  weekday?: string;
  total: number;
  completed: number;
  cancelled: number;
  no_show: number;
  revenue: number;
  revenue_realized?: number;
  revenue_expected: number;
}

export interface ReportBarberRow {
  barber_id: number;
  name: string;
  total: number;
  total_appointments?: number;
  completed: number;
  revenue: number;
  realized: number;
  commission_percent: number;
  commission_value: number;
}

export interface ReportServiceRow {
  service_id: number;
  name: string;
  total: number;
  revenue: number;
}

export interface ReportWeekdayRow {
  weekday: number;
  label: string;
  total: number;
  revenue: number;
  revenue_expected: number;
}

export interface ReportStatusRow {
  status: AppointmentStatus;
  total: number;
  revenue: number;
}

export interface ReportResponse {
  range: {
    from: string;
    to: string;
    days: number;
    active_days: number;
  };
  generated_at: string;
  totals: {
    appointments: number;
    completed: number;
    cancelled: number;
    no_show: number;
    pending: number;
    confirmed: number;
    revenue_realized: number;
    revenue_expected: number;
    average_ticket: number;
    cancellation_rate: number;
    no_show_rate: number;
    completion_rate: number;
    revenue_per_active_day?: number;
    new_clients: number;
    returning_clients: number;
    repeat_rate: number;
    occupancy_rate?: number | null;
  };
  occupancy: {
    available_minutes: number;
    booked_minutes: number;
    rate: number | null;
  };
  comparison: {
    previous_from: string;
    previous_to: string;
    previous_appointments: number;
    previous_revenue_realized: number;
    revenue_growth_pct: number;
  };
  by_status: ReportStatusRow[];
  by_barber: ReportBarberRow[];
  by_service: ReportServiceRow[];
  by_weekday: ReportWeekdayRow[];
  daily: ReportDailyRow[];
  filter?: {
    barber_id?: number | null;
    from: string;
    to: string;
  };
}

export interface Expense {
  id: number;
  description: string;
  category: string;
  amount: number;
  payment_method: PaymentMethod | string;
  date: string;
  notes?: string | null;
  created_at?: string;
}

export interface FinanceSummaryResponse {
  range: {
    from: string;
    to: string;
  };
  summary: {
    revenue_realized: number;
    revenue_expected: number;
    completed_count: number;
    total_commissions: number;
    total_expenses: number;
    net_profit: number;
  };
  by_payment_method: Array<{
    payment_method: PaymentMethod | string;
    count: number;
    total: number;
  }>;
  expenses_by_category: Array<{
    category: string;
    count: number;
    total: number;
  }>;
  expenses: Expense[];
  cash_closing: Array<{
    date: string;
    revenue: number;
    expenses: number;
    net: number;
  }>;
}

export interface CutGalleryItem {
  title: string;
  desc: string;
  tag?: string;
  img?: string;
}

export interface PublicShopInfo {
  id: number;
  slug: string;
  name: string;
  company: string;
  description: string;
  phone: string;
  whatsapp: string;
  address: string;
  instagram: string;
  logo_url?: string | null;
  cover_url?: string | null;
  primary_color?: string;
  cuts_gallery?: CutGalleryItem[];
  business_hours: BusinessHours[];
  closures: Closure[];
  public_booking: boolean;
  min_advance_minutes: number;
  max_advance_days: number;
  demo: boolean;
}

export interface ShopReview {
  id?: number;
  client_name: string;
  rating: number;
  comment: string;
  created_at?: string;
}

export interface PublicConfigResponse {
  shop: PublicShopInfo;
  services: Service[];
  barbers: Barber[];
  reviews: ShopReview[];
}

export interface PublicCalendarDay {
  date: string;
  open: boolean;
  slots_count?: number;
  reason?: string;
}

export interface AvailabilityResponse {
  open: boolean;
  slots: string[];
  reason?: string;
}

export interface PublicBookingResponse {
  appointment: Appointment;
  manage_url?: string;
  confirmation?: {
    whatsapp_automated?: boolean;
  };
}

export interface AuthMeResponse {
  authenticated: boolean;
  demo?: boolean;
  password_is_default?: boolean;
  is_master?: boolean;
  totp_enabled?: boolean;
  totp_required?: boolean;
  mfa_verified?: boolean;
  shop_name?: string;
  oauth_providers?: {
    google?: boolean;
  };
  user?: {
    email: string;
    role: string;
    shop_id: number;
  };
}

export interface BillingPlanResponse {
  plan?: {
    name: string;
    max_barbers?: number | null;
  };
  usage?: {
    active_barbers: number;
  };
}

export interface WhatsAppConfig {
  configured?: boolean;
  is_configured?: boolean;
  enabled: boolean;
  phone_number_id?: string;
  business_account_id?: string;
  has_access_token?: boolean;
  api_version?: string;
  admin_phone?: string;
  notify_admin?: boolean;
  notify_barber?: boolean;
  reminder_enabled?: boolean;
  reminder_hours?: number;
  use_templates?: boolean;
  templates?: {
    confirmation?: string;
    reminder?: string;
    cancellation?: string;
    reschedule?: string;
  };
  webhook_callback_url?: string;
  has_webhook_token?: boolean;
}

export interface WhatsAppMessage {
  id: number;
  message_type: string;
  recipient_name?: string | null;
  recipient_phone: string;
  appointment_id?: number | null;
  client_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  status: string;
  error_message?: string | null;
  meta_message_id?: string | null;
  created_at: string;
}

export interface HealthResponse {
  status: string;
  driver?: string;
  target?: string;
  environment?: string;
  company?: string;
  uptime_seconds?: number;
}

export interface BackupMeta {
  generated_at: string;
  driver?: string;
  counts?: Record<string, number>;
}

export interface BackupResponse {
  meta?: BackupMeta;
  data?: Record<string, unknown>;
}
