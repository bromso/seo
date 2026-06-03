/**
 * Supabase Database Types
 * These types match the Supabase GraphQL schema
 */

// Base types for relay-style pagination
export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

export interface Edge<T> {
  cursor: string
  node: T
}

export interface Collection<T> {
  edges: Edge<T>[]
  pageInfo: PageInfo
}

// Project (Campaign) types - using snake_case to match Supabase GraphQL response
export interface Project {
  id: string
  nodeId: string
  name: string
  description: string | null
  status: string | null
  created_at: string
  updated_at: string
  organization_id: string | null
}

export interface ProjectsQueryResult {
  projectsCollection: Collection<Project> | null
}

export interface ProjectQueryResult {
  projectsCollection: Collection<Project> | null
}

// Asset types - using snake_case to match Supabase GraphQL response
export interface Asset {
  id: string
  nodeId: string
  name: string
  description: string | null
  asset_type: string | null
  workflow_status: string | null
  storage_key: string | null
  file_url: string | null
  thumbnail_url: string | null
  project_id: string | null
  created_at: string
  updated_at: string
}

export interface AssetsQueryResult {
  assetsCollection: Collection<Asset> | null
}

export interface AssetQueryResult {
  assetsCollection: Collection<Asset> | null
}

// Profile (User) types - using snake_case to match Supabase GraphQL response
export interface Profile {
  id: string
  nodeId: string
  email: string
  full_name: string | null
  avatar_url: string | null
  organization_id: string | null
  created_at: string
  updated_at: string
}

export interface ProfilesQueryResult {
  profilesCollection: Collection<Profile> | null
}

export interface ProfileQueryResult {
  profilesCollection: Collection<Profile> | null
}

// Team types - using snake_case to match Supabase GraphQL response
export interface Team {
  id: string
  nodeId: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface TeamsQueryResult {
  teamsCollection: Collection<Team> | null
}

// Brand Guidelines types - using snake_case to match Supabase GraphQL response
export interface BrandGuideline {
  id: string
  nodeId: string
  category: string
  title: string
  description: string | null
  content: string | null
  created_at: string
  updated_at: string
}

export interface BrandGuidelinesQueryResult {
  brandGuidelinesCollection: Collection<BrandGuideline> | null
}

// Notification types - using snake_case to match Supabase GraphQL response
export interface Notification {
  id: string
  nodeId: string
  type: string
  message: string
  read: boolean
  user_id: string
  created_at: string
}

export interface NotificationsQueryResult {
  notificationsCollection: Collection<Notification> | null
}

// Filter types for queries
export interface StringFilter {
  eq?: string
  neq?: string
  in?: string[]
  is?: "NULL" | "NOT NULL"
}

export interface BooleanFilter {
  eq?: boolean
  is?: "NULL" | "NOT NULL"
}

export interface OrderByDirection {
  direction: "AscNullsFirst" | "AscNullsLast" | "DescNullsFirst" | "DescNullsLast"
}
