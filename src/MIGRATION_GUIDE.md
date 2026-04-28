# Supabase Migration Guide

## Overview
This document outlines all Base44 SDK dependencies and features that need to be migrated to Supabase.

---

## 1. ENTITY OPERATIONS (Base44 → Supabase)

### Entities Used
- **Trip**: Ride data with driver info, pricing, status, car details
- **Booking**: Passenger bookings with trip references
- **Message**: Chat messages between users (with phone number blocking validation)
- **Review**: Trip ratings and reviews (passenger_rates_driver, driver_rates_passenger)
- **Notification**: User notifications for trips and preferences
- **TripPreference**: Saved user preferences for alerts
- **SupportTicket**: Support requests from users
- **Coupon**: Discount codes with usage tracking
- **AppSettings**: Global app configuration
- **Announcement**: Active announcements for users
- **User**: Built-in user entity (may need custom implementation in Supabase)

### Migration Tasks
- [ ] Create Supabase tables matching all entity schemas (see entities/*.json)
- [ ] Implement Row Level Security (RLS) policies for user isolation
- [ ] Set up database triggers for timestamps (created_date, updated_date)
- [ ] Add created_by field tracking (user email)

### Current SDK Usage Pattern
```javascript
// Replace all instances of:
base44.entities.EntityName.list()
base44.entities.EntityName.filter({ field: value })
base44.entities.EntityName.create(data)
base44.entities.EntityName.update(id, data)
base44.entities.EntityName.delete(id)

// With Supabase equivalents:
supabase.from('entity_name').select()
supabase.from('entity_name').select().eq('field', value)
supabase.from('entity_name').insert([data])
supabase.from('entity_name').update(data).eq('id', id)
supabase.from('entity_name').delete().eq('id', id)
```

---

## 2. REAL-TIME SUBSCRIPTIONS (Base44 → Supabase)

### Current Implementation
Files using real-time subscriptions:
- **pages/Notifications.jsx**: Line ~23, 32 - Trip preference & notification updates
- **pages/MyTrips.jsx**: Line ~29, 31 - Trip & review real-time updates
- **pages/SearchTrips.jsx**: Line ~33 - Trip list updates
- **components/home/FeaturedTrips.jsx**: Line ~28 - Featured trips subscription
- **components/home/StatsBar.jsx**: Line ~32, 35 - Stats real-time updates

### Current Code Pattern
```javascript
const unsubscribe = base44.entities.EntityName.subscribe((event) => {
  // event.type: 'create' | 'update' | 'delete'
  // event.data: current entity data
  // event.id: entity ID
  qc.invalidateQueries({ queryKey: ['key'] });
});
return () => unsubscribe();
```

### Supabase Equivalent
```javascript
const subscription = supabase
  .channel('public:entity_name')
  .on('postgres_changes', 
    { event: '*', schema: 'public', table: 'entity_name' },
    (payload) => {
      // payload.eventType: 'INSERT' | 'UPDATE' | 'DELETE'
      // payload.new: new row data
      qc.invalidateQueries({ queryKey: ['key'] });
    }
  )
  .subscribe();
return () => supabase.removeChannel(subscription);
```

---

## 3. AUTHENTICATION

### Current Implementation
- **lib/AuthContext.jsx**: Custom auth context using Base44
- **base44.auth.me()**: Get current user
- **base44.auth.updateMe(data)**: Update user profile
- **base44.auth.redirectToLogin()**: Login redirect
- **base44.auth.logout()**: Logout
- **base44.auth.isAuthenticated()**: Check auth status

### Migration Tasks
- [ ] Replace with Supabase Auth (email/password or OAuth)
- [ ] Implement session management with supabase.auth.getSession()
- [ ] Update AuthContext to use Supabase auth state
- [ ] Create user profile table linked to auth.users

### Files to Update
- lib/AuthContext.jsx
- All pages using base44.auth.*

---

## 4. BACKEND FUNCTIONS

### Current Functions
- **functions/matchTripsToPreferences.js**: Matches trips to user preferences and creates notifications

### Migration Tasks
- [ ] Convert function to Supabase Edge Function
- [ ] Replace base44.entities.* calls with Supabase client calls
- [ ] Update trigger/automation to call Supabase function instead

### Function Details
**matchTripsToPreferences** (lines 1-83)
- Triggered by: Trip creation or update
- Purpose: Match trips against user preferences, create notifications
- Dependencies: Trip, TripPreference, Notification entities
- Logic: Compare trip route/price/date against preferences, avoid duplicate notifications within 24h

---

## 5. INTEGRATIONS

### Current Integrations Used
- **Core.InvokeLLM**: For AI-powered features (if any added later)
- **Core.UploadFile**: File uploads (avatar, car images)
- **Core.SendEmail**: Email notifications (if implemented)

### Migration Tasks
- [ ] Replace UploadFile with Supabase Storage
- [ ] Replace SendEmail with Supabase Email (or third-party like Resend)
- [ ] Replace InvokeLLM with external LLM API (OpenAI, Anthropic, etc.)

### Current Usage
- Avatar uploads in Onboarding page
- Car images in CreateTrip page
- Trip/booking confirmation emails (if sending any)

---

## 6. VALIDATION & BUSINESS LOGIC

### Phone Number Blocking (Messages)
**Location**: pages/Messages.jsx, line 70
- Regex: `/\b(?:\+?966|0)?[5-9]\d{8}\b|(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/`
- Behavior: Prevents sharing phone numbers in messages
- **Keep as-is** (client-side validation)

### Phone Number Visibility (Conditional)
**Locations**:
- pages/TripDetails.jsx, line 331-344: Show driver phone only for confirmed trips
- pages/UserProfile.jsx, line 103-108: Show phone only if user has confirmed booking with driver

**Logic to Preserve**:
```javascript
// Only show phone if trip status === "confirmed"
// Only show phone if there's a confirmed booking between users
```

---

## 7. QUERIES & FILTERS

### Query Patterns Used
```javascript
// Most common patterns:
base44.entities.Entity.list('-created_date', limit)
base44.entities.Entity.filter({ field: value }, '-created_date', limit)
```

### Supabase Equivalents
```javascript
// List with ordering
supabase.from('entity').select().order('created_date', { ascending: false }).limit(limit)

// Filter
supabase.from('entity').select().eq('field', value).order('created_date', { ascending: false }).limit(limit)
```

---

## 8. FILES TO PRIORITIZE FOR MIGRATION

### High Priority
1. **lib/AuthContext.jsx** - Core authentication
2. **functions/matchTripsToPreferences.js** - Trip matching logic
3. **pages/Notifications.jsx** - Preferences and alerts
4. **pages/SearchTrips.jsx** - Trip browsing

### Medium Priority
4. **pages/MyTrips.jsx** - User's trips
5. **pages/CreateTrip.jsx** - Trip creation
6. **pages/Messages.jsx** - Messaging (keep phone validation)

### Lower Priority
7. Remaining pages with entity read-only operations

---

## 9. SPECIFIC MIGRATIONS BY FILE

### pages/Notifications.jsx
- Line 23: `base44.entities.Notification.subscribe()`
- Line 32: `base44.entities.TripPreference.subscribe()`
- All create/update/delete mutations on TripPreference, Notification

### pages/MyTrips.jsx
- Line 29-31: Real-time subscriptions for trips and reviews
- All trip and review queries

### pages/SearchTrips.jsx
- Line 33: Trip real-time subscription
- Trip list and filtering logic

### pages/CreateTrip.jsx
- Trip creation mutation
- File uploads for car images

### pages/Messages.jsx
- Message CRUD operations (if persisting to database later)
- Keep phone number validation regex (line 70)

### pages/UserProfile.jsx
- Trip filtering by created_by (driver profile)
- Review queries filtered by driver_email

---

## 10. CHECKLIST FOR SUPABASE SETUP

- [ ] Create all 11 entity tables with correct schemas
- [ ] Set up authentication (auth.users linked to public.user table if needed)
- [ ] Configure RLS policies for each table
- [ ] Create Edge Functions for backend logic (matchTripsToPreferences)
- [ ] Set up storage bucket for images/avatars
- [ ] Configure real-time publication for tables needing subscriptions
- [ ] Set up automated tasks/cron jobs (for trip status updates, notifications)
- [ ] Test all queries and mutations with Supabase client
- [ ] Implement error handling for Supabase errors (vs Base44 errors)
- [ ] Test real-time subscriptions with Supabase

---

## 11. NOTES

- Base44 SDK automatically handles timestamps (created_date, updated_date) - manual setup needed in Supabase
- Base44 automatically tracks created_by - implement with `auth.uid()` in Supabase RLS
- All phone number validations are client-side and can remain unchanged
- Email sending functionality not yet implemented - add when migrating
- LLM integrations (if added) should use external APIs directly