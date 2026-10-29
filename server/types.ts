// Definicoes de tipos TypeScript para o Gestor de Barbearia

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type AppointmentSource = 'admin' | 'public';

export interface Barber {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  color: string | null;
  commission: number;
  active: number;
  created_at: string;
}

export interface BarberHours {
  id: number;
  barber_id: number;
  weekday: number;
  is_working: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

export interface Service {
  id: number;
  name: string;
  price: number;
  duration_min: number;
  description: string | null;
  active: number;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export interface BusinessHours {
  weekday: number;
  is_open: number;
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
  client_id: number;
  barber_id: number;
  service_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  price: number;
  notes: string | null;
  source: AppointmentSource;
  created_at: string;
  updated_at: string | null;
  client_name?: string;
  client_phone?: string;
  client_email?: string | null;
  barber_name?: string;
  barber_color?: string | null;
  service_name?: string | null;
  service_duration?: number | null;
}

export interface DashboardMetrics {
  today_count: number;
  today_completed: number;
  today_revenue: number;
  today_pending: number;
  month_revenue: number;
  occupancy_rate: number;
}
