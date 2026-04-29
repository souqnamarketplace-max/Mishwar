import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all approved driver licenses
    const licenses = await base44.asServiceRole.entities.DriverLicense.filter(
      { status: 'approved' },
      '-created_date',
      1000
    );

    const today = new Date();
    const thirtyDaysLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const license of licenses) {
      const dates = [
        { field: 'expiry_date', name: 'رخصة القيادة', date: license.expiry_date },
        { field: 'car_registration_expiry_date', name: 'تسجيل المركبة', date: license.car_registration_expiry_date },
        { field: 'insurance_expiry_date', name: 'التأمين', date: license.insurance_expiry_date },
      ];

      for (const item of dates) {
        if (!item.date) continue;

        const expiryDate = new Date(item.date);
        const alreadyNotified = await base44.asServiceRole.entities.Notification.filter(
          {
            user_email: license.driver_email,
            title: `⏰ تنبيه: ${item.name} ينتهي قريباً`,
          },
          '-created_date',
          1
        );

        // Only send if expiry is within 30 days and no notification sent this week
        if (expiryDate <= thirtyDaysLater && expiryDate > today) {
          if (alreadyNotified.length === 0 || isOlderThan7Days(alreadyNotified[0].created_date)) {
            await base44.asServiceRole.entities.Notification.create({
              user_email: license.driver_email,
              title: `⏰ تنبيه: ${item.name} ينتهي قريباً`,
              message: `صلاحية ${item.name} تنتهي في ${item.date}. يرجى تحديث المستندات من الإعدادات لتتمكن من نشر الرحلات.`,
              type: 'system',
              is_read: false,
            });
          }
        }

        // Block if already expired
        if (expiryDate < today) {
          await base44.asServiceRole.entities.DriverLicense.update(license.id, {
            status: 'rejected',
            rejection_reason: `انتهت صلاحية ${item.name}`,
          });
        }
      }
    }

    return Response.json({ success: true, checked: licenses.length });
  } catch (error) {
    console.error('Expiry check error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function isOlderThan7Days(createdDate) {
  const notifDate = new Date(createdDate);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return notifDate < sevenDaysAgo;
}