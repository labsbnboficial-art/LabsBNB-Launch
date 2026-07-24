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
      activity: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json | null
          token_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json | null
          token_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          token_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_config: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          payload: Json | null
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          target?: string | null
        }
        Relationships: []
      }
      bonding_curves: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          progress_bps: number
          real_bnb_reserves: number
          target_bnb: number
          token_id: string
          updated_at: string
          virtual_bnb_reserves: number
          virtual_token_reserves: number
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          progress_bps?: number
          real_bnb_reserves?: number
          target_bnb?: number
          token_id: string
          updated_at?: string
          virtual_bnb_reserves?: number
          virtual_token_reserves?: number
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          progress_bps?: number
          real_bnb_reserves?: number
          target_bnb?: number
          token_id?: string
          updated_at?: string
          virtual_bnb_reserves?: number
          virtual_token_reserves?: number
        }
        Relationships: [
          {
            foreignKeyName: "bonding_curves_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: true
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          content: string
          created_at: string
          id: string
          token_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          token_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          token_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          token_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          token_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          token_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      fees: {
        Row: {
          amount: number
          created_at: string
          destination_wallet: string
          fee_bps: number
          id: string
          token_id: string | null
          trade_id: string | null
          tx_hash: string
          user_id: string | null
          wallet_address: string
        }
        Insert: {
          amount: number
          created_at?: string
          destination_wallet: string
          fee_bps: number
          id?: string
          token_id?: string | null
          trade_id?: string | null
          tx_hash: string
          user_id?: string | null
          wallet_address: string
        }
        Update: {
          amount?: number
          created_at?: string
          destination_wallet?: string
          fee_bps?: number
          id?: string
          token_id?: string | null
          trade_id?: string | null
          tx_hash?: string
          user_id?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "fees_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fees_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          updated_at: string
          username: string | null
          wallet_address: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id: string
          updated_at?: string
          username?: string | null
          wallet_address?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          username?: string | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          comment_id: string | null
          created_at: string
          id: string
          reason: string
          reporter_id: string
          status: string
          token_id: string | null
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          id?: string
          reason: string
          reporter_id: string
          status?: string
          token_id?: string | null
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string
          status?: string
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          banner_url: string | null
          category: string | null
          chain_id: number
          contract_address: string | null
          created_at: string
          creator_id: string | null
          decimals: number
          deploy_tx_hash: string | null
          description: string | null
          discord: string | null
          github: string | null
          graduated_at: string | null
          id: string
          logo_url: string | null
          name: string
          status: Database["public"]["Enums"]["token_status"]
          supply: number
          telegram: string | null
          ticker: string
          twitter: string | null
          website: string | null
        }
        Insert: {
          banner_url?: string | null
          category?: string | null
          chain_id?: number
          contract_address?: string | null
          created_at?: string
          creator_id?: string | null
          decimals?: number
          deploy_tx_hash?: string | null
          description?: string | null
          discord?: string | null
          github?: string | null
          graduated_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          status?: Database["public"]["Enums"]["token_status"]
          supply?: number
          telegram?: string | null
          ticker: string
          twitter?: string | null
          website?: string | null
        }
        Update: {
          banner_url?: string | null
          category?: string | null
          chain_id?: number
          contract_address?: string | null
          created_at?: string
          creator_id?: string | null
          decimals?: number
          deploy_tx_hash?: string | null
          description?: string | null
          discord?: string | null
          github?: string | null
          graduated_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          status?: Database["public"]["Enums"]["token_status"]
          supply?: number
          telegram?: string | null
          ticker?: string
          twitter?: string | null
          website?: string | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          amount_bnb: number
          amount_token: number
          created_at: string
          id: string
          price: number
          side: Database["public"]["Enums"]["trade_side"]
          token_id: string
          tx_hash: string
          user_id: string | null
          wallet_address: string
        }
        Insert: {
          amount_bnb: number
          amount_token: number
          created_at?: string
          id?: string
          price: number
          side: Database["public"]["Enums"]["trade_side"]
          token_id: string
          tx_hash: string
          user_id?: string | null
          wallet_address: string
        }
        Update: {
          amount_bnb?: number
          amount_token?: number
          created_at?: string
          id?: string
          price?: number
          side?: Database["public"]["Enums"]["trade_side"]
          token_id?: string
          tx_hash?: string
          user_id?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_wallet: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      token_status: "pending" | "active" | "graduated" | "failed"
      trade_side: "buy" | "sell"
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
      app_role: ["admin", "moderator", "user"],
      token_status: ["pending", "active", "graduated", "failed"],
      trade_side: ["buy", "sell"],
    },
  },
} as const
