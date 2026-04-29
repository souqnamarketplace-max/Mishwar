import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data, old_data } = await req.json();

    // Only notify on status changes
    if (!data || !old_data || data.status === old_data.status) {
      return Response.json({ success: true });
    }

    const driverEmail = data.driver_email;
    const driverName = data.driver_name || 'Driver';
    const newStatus = data.status;
    const rejectionReason = data.rejection_reason;

    let title = '';
    let message = '';

    if (newStatus === 'approved') {
      title = '✅ رخصتك موافق عليها!';
      message = `تم الموافقة على رخصة القيادة الخاصة بك. يمكنك الآن نشر الرحلات.`;
    } else if (newStatus === 'rejected') {
      title = '❌ تم رفض رخصتك';
      message = `للأسف، تم رفض رخصة القيادة الخاصة بك. السبب: ${rejectionReason || 'لم يتم تحديد السبب'}. يرجى تحديث المستندات والمحاولة مجدداً.`;
    }

    if (!title) {
      return Response.json({ success: true });
    }

    await base44.asServiceRole.entities.Notification.create({
      user_email: driverEmail,
      title,
      message,
      type: 'system',
      is_read: false,
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('License notification error:', error);
    return Response.json({ error: 'Failed to create notification' }, { status: 500 });
  }
});