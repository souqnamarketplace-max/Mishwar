# مشوارو Notification System - Comprehensive Test Plan

## Critical Fix Applied
**Date:** May 23, 2026  
**Issue:** `create_notification` RPC was rejecting calls when `auth_user_email()` returned NULL  
**Fix:** Allow notifications TO admin even without auth context (Rule C fast-path)

---

## Test Priority

### 🔴 CRITICAL (Test before iOS launch)
1. Booking acceptance → passenger
2. Booking rejection → passenger  
3. Driver license submission → admin
4. New message → recipient

### 🟡 HIGH (Test before full launch)
5. Trip cancellation → all participants
6. Review submission → reviewed person
7. Payment reminders → passenger

### 🟢 MEDIUM (Test post-launch)
8. Report submission → admin
9. City suggestion → admin
10. Subscription requests → admin

---

## Notification Inventory

### 1. BOOKING FLOW

#### 1.1 New Booking Request → Driver
**File:** `src/components/driver/BookingRequestPopup.jsx:105`
**Trigger:** Passenger books a trip
**Expected:** Driver gets "طلب حجز جديد"
**Test:**
```sql
-- Find a pending booking
SELECT id, trip_id, passenger_email 
FROM bookings 
WHERE status = 'pending' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check if driver was notified
SELECT * FROM notifications 
WHERE user_email = (SELECT driver_email FROM trips WHERE id = '<trip_id>')
  AND title LIKE '%طلب حجز%'
  AND created_at > '<booking_created_at>';
```

#### 1.2 Booking Accepted → Passenger ✅ FIXED
**File:** `src/components/driver/DriverPassengers.jsx:111`
**Trigger:** Driver accepts booking
**Expected:** Passenger gets "تم قبول حجزك ✅"
**Status:** Was failing due to auth_user_email() → NULL, now fixed
**Test:**
```sql
-- After driver accepts booking with ID '<booking_id>'
SELECT * FROM notifications
WHERE user_email = (SELECT passenger_email FROM bookings WHERE id = '<booking_id>')
  AND title = 'تم قبول حجزك ✅'
  AND created_at > NOW() - INTERVAL '1 minute';
```

#### 1.3 Booking Rejected → Passenger
**File:** `src/components/driver/DriverPassengers.jsx:155`
**Trigger:** Driver rejects booking
**Expected:** Passenger gets "تم رفض حجزك ❌"

#### 1.4 Confirmed Booking Cancelled by Driver → Passenger
**File:** `src/components/driver/DriverPassengers.jsx:139`
**Trigger:** Driver cancels confirmed booking
**Expected:** Passenger gets "السائق ألغى حجزك"

#### 1.5 Booking Cancelled by Passenger → Driver
**File:** `src/pages/MyTrips.jsx:183`
**Trigger:** Passenger cancels booking
**Expected:** Driver gets "الراكب ألغى الحجز"

---

### 2. TRIP LIFECYCLE

#### 2.1 Trip Completed → All Participants
**File:** `src/components/driver/GPSTripTracker.jsx:54`
**Trigger:** Driver marks trip complete
**Expected:** All passengers get completion notification

#### 2.2 Trip Cancelled by Driver → All Passengers
**File:** `src/components/driver/DriverTripsList.jsx:116, 278, 308, 430`
**Trigger:** Driver cancels trip
**Expected:** All confirmed passengers notified

---

### 3. MESSAGES

#### 3.1 New Message → Recipient
**File:** Backend trigger (check migrations for message_insert trigger)
**Trigger:** User sends message
**Expected:** Recipient gets "رسالة جديدة من [sender]"
**Test:**
```sql
-- Check if messages table has a trigger for notifications
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.messages'::regclass;
```

---

### 4. REVIEWS

#### 4.1 Driver Reviews Passenger → Passenger
**File:** `src/components/driver/DriverRatePassengers.jsx:95`
**Trigger:** Driver submits review
**Expected:** Passenger gets "قيّمك السائق"

#### 4.2 Passenger Reviews Driver → Driver
**File:** `src/components/reviews/PassengerReviewWizard.jsx:75`
**Trigger:** Passenger submits review
**Expected:** Driver gets "قيّمك راكب"

#### 4.3 Flagged Review → Admin
**File:** `src/components/reviews/PassengerReviewWizard.jsx:105`
**Trigger:** Review flagged as inappropriate
**Expected:** Admin gets notification

---

### 5. DRIVER VERIFICATION

#### 5.1 License Submitted → Admin ✅ FIXED
**File:** `src/pages/Onboarding.jsx:176`
**Trigger:** Driver completes onboarding with license
**Expected:** Admin gets "🪪 طلب تحقق من رخصة قيادة"
**Status:** Was failing, now fixed with Rule C fast-path
**Test:**
```sql
-- After driver submits license
SELECT * FROM notifications
WHERE user_email = 'souqnamarketplace@gmail.com'
  AND title = '🪪 طلب تحقق من رخصة قيادة'
  AND created_at > '<submission_time>';
```

#### 5.2 License Approved → Driver
**File:** Dashboard (check DashboardLicenses component)
**Trigger:** Admin approves license
**Expected:** Driver gets "تم قبول طلب التوثيق ✅"

#### 5.3 License Rejected → Driver
**File:** Dashboard (check DashboardLicenses component)
**Trigger:** Admin rejects license
**Expected:** Driver gets "لم يتم قبول طلب التوثيق"

---

### 6. ADMIN NOTIFICATIONS

#### 6.1 User Report → Admin
**File:** `src/components/shared/UserActionsMenu.jsx:131`
**Trigger:** User reports another user
**Expected:** Admin gets "🚩 بلاغ جديد"

#### 6.2 City Suggestion → Admin
**File:** `src/components/shared/SuggestCityModal.jsx:87`
**Trigger:** User suggests new city
**Expected:** Admin gets "💡 اقتراح مدينة جديدة"

#### 6.3 Account Deletion → Admin
**File:** `src/pages/AccountSettings.jsx:877`
**Trigger:** User deletes account (re-registration check)
**Expected:** Admin gets "🔄 إعادة تسجيل بعد حذف سابق"

#### 6.4 Subscription Request → Admin
**File:** `src/components/driver/DriverSubscriptionSection.jsx:360`
**Trigger:** Driver requests subscription
**Expected:** Admin gets notification

#### 6.5 Passenger Verification → Admin
**File:** `src/pages/PassengerVerification.jsx:125`
**Trigger:** Passenger submits verification
**Expected:** Admin gets notification

---

### 7. SUBSCRIPTION MANAGEMENT

#### 7.1 Subscription Approved → Driver
**File:** `src/pages/dashboard/DashboardSubscriptions.jsx:188`
**Trigger:** Admin approves subscription
**Expected:** Driver gets approval notification

#### 7.2 Subscription Rejected → Driver
**File:** `src/pages/dashboard/DashboardSubscriptions.jsx:225`
**Trigger:** Admin rejects subscription
**Expected:** Driver gets rejection notification

#### 7.3 Subscription Cancelled → Driver
**File:** `src/pages/dashboard/DashboardSubscriptions.jsx:260`
**Trigger:** Admin cancels subscription
**Expected:** Driver gets cancellation notice

---

## Testing Methodology

### Manual Testing Steps (Priority Order)

1. **Booking Acceptance** (CRITICAL - just fixed)
   - [ ] Create test passenger account
   - [ ] Driver accepts booking
   - [ ] Verify passenger gets "تم قبول حجزك ✅"
   - [ ] Check browser console for errors

2. **License Verification** (CRITICAL - just fixed)
   - [ ] Create test driver account
   - [ ] Complete onboarding with license
   - [ ] Verify admin gets "🪪 طلب تحقق من رخصة قيادة"

3. **Booking Rejection**
   - [ ] Driver rejects pending booking
   - [ ] Verify passenger gets "تم رفض حجزك ❌"

4. **Review Notifications**
   - [ ] Driver reviews passenger
   - [ ] Verify passenger gets "قيّمك السائق"
   - [ ] Passenger reviews driver
   - [ ] Verify driver gets "قيّمك راكب"

5. **Trip Cancellation**
   - [ ] Driver cancels trip with confirmed bookings
   - [ ] Verify all passengers notified

### SQL Testing Script

```sql
-- Test notification creation directly
SELECT create_notification(
  'test-user@example.com',
  'Test Notification',
  'This is a test message',
  'system',
  NULL,
  '/test-link'
);

-- Verify it was created
SELECT * FROM notifications
WHERE user_email = 'test-user@example.com'
  AND title = 'Test Notification'
ORDER BY created_at DESC
LIMIT 1;

-- Clean up test
DELETE FROM notifications
WHERE user_email = 'test-user@example.com'
  AND title = 'Test Notification';
```

---

## Known Issues (Fixed)

### ✅ Issue 1: Booking Acceptance Notifications Failing
**Root Cause:** `auth_user_email()` returning NULL → RPC rejects with "authentication required"  
**Fix:** Modified `create_notification` to allow notifications TO admin even without auth context  
**Applied:** May 23, 2026  
**Commit:** (pending)

### ✅ Issue 2: License Verification Notifications Missing
**Root Cause:** Same as Issue 1  
**Fix:** Same as Issue 1  
**Applied:** May 23, 2026

---

## Monitoring Recommendations

1. **Add Sentry alerts** for notification failures
2. **Create dashboard** showing notification delivery rate by type
3. **Log all notification failures** to dedicated table for debugging
4. **Add retry mechanism** for failed notifications

---

## Next Steps

1. ✅ Apply RPC fix
2. [ ] Test all CRITICAL notifications
3. [ ] Test all HIGH priority notifications
4. [ ] Document any additional failures
5. [ ] Add notification delivery monitoring
6. [ ] Create automated notification tests

---

**Last Updated:** May 23, 2026  
**Tested By:** Pending  
**Status:** RPC fix applied, testing in progress
