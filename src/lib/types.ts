export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      branches: {
        Row: {
          id: string
          name: string
          address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: string | null
          created_at?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          id: string
          name: string
          notes: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      contract_payments: {
        Row: {
          id: string
          contract_id: string
          branch_id: string | null
          amount: number
          paid_at: string
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          contract_id: string
          branch_id?: string | null
          amount: number
          paid_at?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          contract_id?: string
          branch_id?: string | null
          amount?: number
          paid_at?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      employees: {
        Row: {
          id: string
          auth_id: string | null
          name: string
          username: string | null
          role: Database["public"]["Enums"]["user_role"]
          branch_id: string | null
          phone: string | null
          created_at: string
          permission_dashboard: boolean | null
          permission_reception: boolean | null
          permission_work_orders: boolean | null
          permission_customers: boolean | null
          permission_reports: boolean | null
          permission_employees: boolean | null
        }
        Insert: {
          id?: string
          auth_id?: string | null
          name: string
          username?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          branch_id?: string | null
          phone?: string | null
          created_at?: string
          permission_dashboard?: boolean | null
          permission_reception?: boolean | null
          permission_work_orders?: boolean | null
          permission_customers?: boolean | null
          permission_reports?: boolean | null
          permission_employees?: boolean | null
        }
        Update: {
          id?: string
          auth_id?: string | null
          name?: string
          username?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          branch_id?: string | null
          phone?: string | null
          created_at?: string
          permission_dashboard?: boolean | null
          permission_reception?: boolean | null
          permission_work_orders?: boolean | null
          permission_customers?: boolean | null
          permission_reports?: boolean | null
          permission_employees?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      clients: {
        Row: {
          id: string
          name: string
          phone: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          phone: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          phone?: string
          created_at?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          id: string
          client_id: string
          make: string
          model: string
          engine_size: string | null
          plate_number: string | null
          booklet_serial: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          make: string
          model: string
          engine_size?: string | null
          plate_number?: string | null
          booklet_serial?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          make?: string
          model?: string
          engine_size?: string | null
          plate_number?: string | null
          booklet_serial?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          }
        ]
      }
      inspection_reports: {
        Row: {
          id: string
          report_number: number
          branch_id: string | null
          vehicle_id: string | null
          receptionist_id: string | null
          supervisor_id: string | null
          status: Database["public"]["Enums"]["report_status"]
          order_type: string
          odometer_reading: number
          odometer_unit: string
          total_price: number | null
          notes: string | null
          completed_at: string | null
          created_at: string
          estimated_duration: number
          start_time: string | null
          end_time: string | null
          elapsed_time: number
          is_delayed: boolean
          bay_number: string | null
          technician_id: string | null
          technician_rating: string | null
          technician_rating_notes: string | null
          contract_id: string | null
          selected_services: any[]
        }
        Insert: {
          id?: string
          report_number?: number
          branch_id?: string | null
          vehicle_id?: string | null
          receptionist_id?: string | null
          supervisor_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          order_type?: string
          odometer_reading: number
          odometer_unit?: string
          total_price?: number | null
          notes?: string | null
          completed_at?: string | null
          created_at?: string
          estimated_duration?: number
          start_time?: string | null
          end_time?: string | null
          elapsed_time?: number
          is_delayed?: boolean
          bay_number?: string | null
          technician_id?: string | null
          technician_rating?: string | null
          technician_rating_notes?: string | null
          contract_id?: string | null
          selected_services?: any[]
        }
        Update: {
          id?: string
          report_number?: number
          branch_id?: string | null
          vehicle_id?: string | null
          receptionist_id?: string | null
          supervisor_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          order_type?: string
          odometer_reading?: number
          odometer_unit?: string
          total_price?: number | null
          notes?: string | null
          completed_at?: string | null
          created_at?: string
          estimated_duration?: number
          start_time?: string | null
          end_time?: string | null
          elapsed_time?: number
          is_delayed?: boolean
          bay_number?: string | null
          technician_id?: string | null
          technician_rating?: string | null
          technician_rating_notes?: string | null
          contract_id?: string | null
          selected_services?: any[]
        }
        Relationships: [
          {
            foreignKeyName: "inspection_reports_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_reports_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_reports_receptionist_id_fkey"
            columns: ["receptionist_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_reports_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_reports_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          }
        ]
      }
      inventory: {
        Row: {
          id: string
          branch_id: string | null
          item_code: string
          name: string
          category: string
          purchase_price: number
          sell_price: number
          quantity: number | null
          min_quantity: number | null
          created_at: string
        }
        Insert: {
          id?: string
          branch_id?: string | null
          item_code: string
          name: string
          category: string
          purchase_price: number
          sell_price: number
          quantity?: number | null
          min_quantity?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          branch_id?: string | null
          item_code?: string
          name?: string
          category?: string
          purchase_price?: number
          sell_price?: number
          quantity?: number | null
          min_quantity?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      report_services: {
        Row: {
          id: string
          report_id: string | null
          category: string
          status: Database["public"]["Enums"]["service_status"]
          notes: string | null
          service_price: number | null
          photo_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          report_id?: string | null
          category: string
          status: Database["public"]["Enums"]["service_status"]
          notes?: string | null
          service_price?: number | null
          photo_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string | null
          category?: string
          status?: Database["public"]["Enums"]["service_status"]
          notes?: string | null
          service_price?: number | null
          photo_url?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_services_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "inspection_reports"
            referencedColumns: ["id"]
          }
        ]
      }
      used_parts: {
        Row: {
          id: string
          report_id: string | null
          inventory_id: string | null
          quantity: number
          unit_price: number
          total_price: number
          created_at: string
          part_name: string | null
          part_code: string | null
        }
        Insert: {
          id?: string
          report_id?: string | null
          inventory_id?: string | null
          quantity: number
          unit_price: number
          total_price: number
          created_at?: string
          part_name?: string | null
          part_code?: string | null
        }
        Update: {
          id?: string
          report_id?: string | null
          inventory_id?: string | null
          quantity?: number
          unit_price?: number
          total_price?: number
          created_at?: string
          part_name?: string | null
          part_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "used_parts_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "used_parts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "inspection_reports"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_sales: {
        Row: {
          id: number
          total_amount: number
          payment_method: string | null
          items: Json
          created_at: string
        }
        Insert: {
          id?: number
          total_amount: number
          payment_method?: string | null
          items: Json
          created_at?: string
        }
        Update: {
          id?: number
          total_amount?: number
          payment_method?: string | null
          items?: Json
          created_at?: string
        }
        Relationships: []
      }
      workshop_settings: {
        Row: {
          id: number
          setting_key: string
          setting_value: string
        }
        Insert: {
          id?: number
          setting_key: string
          setting_value: string
        }
        Update: {
          id?: number
          setting_key?: string
          setting_value?: string
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          id: string
          branch_id: string | null
          inventory_id: string | null
          item_code: string | null
          item_name: string | null
          transaction_type: string
          quantity_changed: number
          quantity_before: number
          quantity_after: number
          user_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          branch_id?: string | null
          inventory_id?: string | null
          item_code?: string | null
          item_name?: string | null
          transaction_type: string
          quantity_changed: number
          quantity_before: number
          quantity_after: number
          user_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          branch_id?: string | null
          inventory_id?: string | null
          item_code?: string | null
          item_name?: string | null
          transaction_type?: string
          quantity_changed?: number
          quantity_before?: number
          quantity_after?: number
          user_name?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: "Owner" | "Admin" | "Supervisor" | "Receptionist"
      report_status: "تم الاستلام" | "قيد العمل" | "تم الانتهاء" | "متأخر" | "ملغى"
      service_status: "سليم" | "يحتاج صيانة" | "تالف"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Helper types for convenience
export type BranchRow = Database['public']['Tables']['branches']['Row'];
export type EmployeeRow = Database['public']['Tables']['employees']['Row'];
export type ClientRow = Database['public']['Tables']['clients']['Row'];
export type VehicleRow = Database['public']['Tables']['vehicles']['Row'];
export type InspectionReportRow = Database['public']['Tables']['inspection_reports']['Row'];
export type InventoryRow = Database['public']['Tables']['inventory']['Row'];
export type ReportServiceRow = Database['public']['Tables']['report_services']['Row'];
export type UsedPartRow = Database['public']['Tables']['used_parts']['Row'];
export type InventoryTransactionRow = Database['public']['Tables']['inventory_transactions']['Row'];

export type UserRole = Database['public']['Enums']['user_role'];
export type ReportStatus = Database['public']['Enums']['report_status'];
export type ServiceStatus = Database['public']['Enums']['service_status'];
