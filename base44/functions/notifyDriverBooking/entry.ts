import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    if (event.type !== 'create') {
      return Response.json({ success: true });
    }

    const booking = data;

    // Get trip details
    const trips = await base44.asServiceRole.entities.Trip.filter({ id: booking.trip_id });
    const trip = trips?.[0];

    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404 });
    }

    // Create notification for driver
    await base44.asServiceRole.entities.Notification.create({
      user_email: trip.driver_email,
      title: `🎉 حجز جديد لرحلتك`,
      message: `${booking.passenger_name} حجز ${booking.seats_booked} مقاعد في رحلتك من ${trip.from_city} إلى ${trip.to_city}`,
      type: 'system',
      trip_id: trip.id,
      from_city: trip.from_city,
      to_city: trip.to_city,
      is_read: false,
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});