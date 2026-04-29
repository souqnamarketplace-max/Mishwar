/**
 * Sanitization utilities for Supabase migration readiness
 * Database-agnostic sanitization layer
 */

/**
 * Sanitize string input to prevent injection attacks
 * Safe for: user names, descriptions, comments
 */
export const sanitizeString = (input, maxLength = 500) => {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove angle brackets (no HTML tags)
    .replace(/\0/g, ''); // Remove null bytes
};

/**
 * Validate and sanitize email
 */
export const sanitizeEmail = (email) => {
  if (!email || typeof email !== 'string') return null;
  
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(trimmed)) return null;
  
  return trimmed;
};

/**
 * Validate phone number (Palestinian/regional format)
 * Safe regex that prevents obfuscation attempts
 */
export const sanitizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  
  // Remove all non-digits
  const digitsOnly = phone.replace(/\D/g, '');
  
  // Palestinian: 0591234567 or 596 prefix
  // Saudi: 966591234567
  if (/^(966)?[0]?[5-9]\d{7,8}$/.test(digitsOnly)) {
    return digitsOnly;
  }
  
  return null;
};

/**
 * Validate and sanitize text area input
 * Allows newlines, prevents XSS
 */
export const sanitizeTextarea = (input, maxLength = 2000) => {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .slice(0, maxLength)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '') // Remove iframe tags
    .trim();
};

/**
 * Validate numeric input (prices, seat counts)
 */
export const sanitizeNumber = (input, min = 0, max = 999999) => {
  const num = parseInt(input, 10);
  
  if (isNaN(num) || num < min || num > max) {
    return null;
  }
  
  return num;
};

/**
 * Validate date string (ISO format)
 */
export const sanitizeDate = (dateString) => {
  if (!dateString || typeof dateString !== 'string') return null;
  
  // ISO format: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  
  return dateString;
};

/**
 * Sanitize object with schema validation
 * Useful for backend function inputs
 */
export const sanitizeObject = (obj, schema) => {
  if (!obj || typeof obj !== 'object') return null;
  
  const sanitized = {};
  
  for (const [key, validator] of Object.entries(schema)) {
    const value = obj[key];
    
    if (value === undefined && validator.required) {
      throw new Error(`Missing required field: ${key}`);
    }
    
    if (value !== undefined) {
      sanitized[key] = validator.fn(value);
      
      if (sanitized[key] === null && validator.required) {
        throw new Error(`Invalid value for field: ${key}`);
      }
    }
  }
  
  return sanitized;
};

/**
 * Booking input schema for validation
 */
export const BOOKING_SCHEMA = {
  trip_id: {
    required: true,
    fn: (v) => typeof v === 'string' && v.length > 0 ? v : null
  },
  passenger_name: {
    required: true,
    fn: (v) => sanitizeString(v, 100)
  },
  seats_booked: {
    required: true,
    fn: (v) => sanitizeNumber(v, 1, 6)
  },
  total_price: {
    required: true,
    fn: (v) => sanitizeNumber(v, 1, 999999)
  },
  payment_method: {
    required: false,
    fn: (v) => ['cash', 'bank_transfer', 'card'].includes(v) ? v : null
  }
};

/**
 * Trip input schema for validation
 */
export const TRIP_SCHEMA = {
  from_city: {
    required: true,
    fn: (v) => sanitizeString(v, 50)
  },
  to_city: {
    required: true,
    fn: (v) => sanitizeString(v, 50)
  },
  date: {
    required: true,
    fn: (v) => sanitizeDate(v)
  },
  time: {
    required: true,
    fn: (v) => /^\d{2}:\d{2}$/.test(v) ? v : null
  },
  price: {
    required: true,
    fn: (v) => sanitizeNumber(v, 1, 500)
  },
  available_seats: {
    required: true,
    fn: (v) => sanitizeNumber(v, 1, 6)
  },
  car_model: {
    required: true,
    fn: (v) => sanitizeString(v, 100)
  }
};