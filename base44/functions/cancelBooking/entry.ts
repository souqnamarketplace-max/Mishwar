import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { booking_id } = await req.json();
    
    // Get booking
    const bookings = await base44.asServiceRole.entities.Booking.filter({ id: booking_id });
    const booking = bookings?.[0];
    
    if (!booking) {
      return Response.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Get trip
    const trips = await base44.asServiceRole.entities.Trip.filter({ id: booking.trip_id });
    const trip = trips?.[0];
    
    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404 });
    }

    // Check if user is authorized (passenger or driver)
    if (user.email !== booking.passenger_email && user.email !== trip.driver_email) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse trip date and time
    const tripDateTime = new Date(`${trip.date}T${trip.time}`);
    const now = new Date();
    const hoursUntilTrip = (tripDateTime - now) / (1000 * 60 * 60);

    // Check cancellation policy
    let canCancel = false;
    let reason = '';

    if (booking.payment_method === 'نقداً') {
      // Cash: can cancel 2 hours before
      if (hoursUntilTrip >= 2) {
        canCancel = true;
      } else {
        reason = 'لا يمكن إلغاء حجوزات النقد قبل ساعتين من الرحلة';
      }
    } else {
      // Online payment: can cancel 24 hours before
      if (hoursUntilTrip >= 24) {
        canCancel = true;
      } else {
        reason = 'لا يمكن إلغاء الحجوزات المدفوعة إلا قبل 24 ساعة من الرحلة';
      }
    }

    if (!canCancel) {
      return Response.json({ error: reason }, { status: 400 });
    }

    // Update booking status
    await base44.asServiceRole.entities.Booking.update(booking_id, { status: 'cancelled' });

    // Notify the other party
    const notificationEmail = user.email === booking.passenger_email ? trip.driver_email : booking.passenger_email;
    const notificationTitle = user.email === booking.passenger_email ? 'ألغى الراكب حجزه' : 'ألغى السائق الرحلة';
    
    await base44.asServiceRole.entities.Notification.create({
      user_email: notificationEmail,
      title: notificationTitle,
      message: `تم إلغاء الحجز للرحلة من ${trip.from_city} إلى ${trip.to_city} في ${trip.date} ${trip.time}`,
      type: 'system',
      trip_id: trip.id,
      is_read: false,
    });

    return Response.json({ success: true, message: 'تم إلغاء الحجز بنجاح' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});