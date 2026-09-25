const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست واحد تابع isSubscriptionExempt — کپی خالص از middleware تا بدون سرور تست شود.
// اگر middleware تغییر کرد، این کپی هم باید به‌روز شود (یا تابع export شود).
function isSubscriptionExempt(method, url) {
  const SUBSCRIPTION_EXEMPT_PATHS = [
    '/api/subscription/me',
    '/api/deposits',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/auth/me/password',
    '/api/auth/me/photo',
  ];
  const path = (url || '').split('?')[0];
  if (path.startsWith('/api/deposits')) return true;
  if (!SUBSCRIPTION_EXEMPT_PATHS.includes(path)) return false;
  return ['GET', 'PUT'].includes(method) || path !== '/api/auth/me';
}

test('مسیرهای تمدید با اشتراک منقضی هم باز می‌مانند', () => {
  assert.equal(isSubscriptionExempt('GET', '/api/subscription/me'), true);
  assert.equal(isSubscriptionExempt('GET', '/api/deposits/mine'), true);
  assert.equal(isSubscriptionExempt('POST', '/api/deposits'), true);
  assert.equal(isSubscriptionExempt('GET', '/api/deposits/incoming'), true);
  assert.equal(isSubscriptionExempt('GET', '/api/auth/me'), true);
  assert.equal(isSubscriptionExempt('POST', '/api/auth/logout'), true);
  assert.equal(isSubscriptionExempt('PUT', '/api/auth/me/password'), true);
  assert.equal(isSubscriptionExempt('PUT', '/api/auth/me/photo'), true);
});

test('مسیرهای کاری با اشتراک منقضی بسته‌اند', () => {
  assert.equal(isSubscriptionExempt('GET', '/api/plans/mine'), false);
  assert.equal(isSubscriptionExempt('POST', '/api/exams'), false);
  assert.equal(isSubscriptionExempt('GET', '/api/students/mine'), false);
  assert.equal(isSubscriptionExempt('PUT', '/api/admin/institutes/xyz/subscription'), false);
});

test('query string در تشخیص مسیر نادیده گرفته می‌شود', () => {
  assert.equal(isSubscriptionExempt('GET', '/api/subscription/me?x=1'), true);
});

test('دسترسی‌های ناامن به /api/auth/me آزاد نمی‌شوند', () => {
  assert.equal(isSubscriptionExempt('POST', '/api/auth/me'), false);
  assert.equal(isSubscriptionExempt('DELETE', '/api/auth/me'), false);
});
