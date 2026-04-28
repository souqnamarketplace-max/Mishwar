import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get the newly created trip from payload (sent by entity automation)
    const body = await req.json().catch(() => ({}));
    const tripData = body?.data || null;

    // Fetch all active preferences
    const preferences = await base44.asServiceRole.entities.TripPreference.filter({ is_active: true });

    if (!preferences || preferences.length === 0) {
      return Response.json({ matched: 0, message: "No active preferences" });
    }

    // Fetch trips to match against (use the new trip if provided, else fetch recent ones)
    let trips = [];
    if (tripData && tripData.from_city) {
      trips = [tripData];
    } else {
      trips = await base44.asServiceRole.entities.Trip.filter({ status: "confirmed" }, "-created_date", 20);
    }

    let notificationsCreated = 0;

    for (const pref of preferences) {
      for (const trip of trips) {
        // Check route match
        const routeMatch =
          trip.from_city === pref.from_city && trip.to_city === pref.to_city;

        if (!routeMatch) continue;

        const reasons = [];

        // Check price match
        if (pref.notify_on_price && pref.max_price && trip.price <= pref.max_price) {
          reasons.push(`السعر ₪${trip.price} ضمن ميزانيتك`);
        } else if (pref.notify_on_price && !pref.max_price) {
          reasons.push(`رحلة جديدة متاحة`);
        }

        // Check date match
        if (pref.notify_on_date && pref.preferred_date && trip.date === pref.preferred_date) {
          reasons.push(`الرحلة في تاريخ ${trip.date}`);
        } else if (pref.notify_on_date && !pref.preferred_date) {
          reasons.push(`رحلة متاحة قريباً`);
        }

        // Only notify if at least one reason matched
        if (reasons.length === 0) continue;

        // Avoid duplicate notifications (check last 24h)
        const existing = await base44.asServiceRole.entities.Notification.filter({
          user_email: pref.user_email,
          trip_id: trip.id,
        });

        if (existing && existing.length > 0) continue;

        // Create notification
        await base44.asServiceRole.entities.Notification.create({
          user_email: pref.user_email,
          title: `رحلة جديدة: ${trip.from_city} ← ${trip.to_city}`,
          message: `${reasons.join(' • ')} | الموعد: ${trip.date} ${trip.time} | السعر: ₪${trip.price}`,
          type: pref.notify_on_date && pref.preferred_date === trip.date ? "date_match" : "new_trip",
          trip_id: trip.id,
          from_city: trip.from_city,
          to_city: trip.to_city,
          is_read: false,
        });

        notificationsCreated++;
      }
    }

    return Response.json({ matched: notificationsCreated, preferences: preferences.length, trips: trips.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});