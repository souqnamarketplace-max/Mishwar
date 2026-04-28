import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Input sanitization
const sanitizeString = (str, maxLen = 500) => {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[<>]/g, '');
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    if (event.type !== 'create') {
      return Response.json({ success: true });
    }

    const booking = data;

    // Input validation
    if (!booking || !booking.trip_id || !booking.passenger_name) {
      return Response.json({ error: 'Invalid booking data' }, { status: 400 });
    }

    if (typeof booking.seats_booked !== 'number' || booking.seats_booked < 1 || booking.seats_booked > 6) {
      return Response.json({ error: 'Invalid seat count' }, { status: 400 });
    }

    // Get trip details
    const trips = await base44.asServiceRole.entities.Trip.filter({ id: booking.trip_id });
    const trip = trips?.[0];

    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404 });
    }

    // Sanitize sensitive data
    const passengerName = sanitizeString(booking.passenger_name, 100);
    const fromCity = sanitizeString(trip.from_city, 50);
    const toCity = sanitizeString(trip.to_city, 50);

    // Create notification for driver
    await base44.asServiceRole.entities.Notification.create({
      user_email: trip.driver_email,
      title: '🎉 حجز جديد لرحلتك',
      message: `${passengerName} حجز ${booking.seats_booked} مقاعد في رحلتك من ${fromCity} إلى ${toCity}`,
      type: 'system',
      trip_id: trip.id,
      from_city: fromCity,
      to_city: toCity,
      is_read: false,
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Notification error:', error);
    return Response.json({ error: 'Failed to create notification' }, { status: 500 });
  }
});