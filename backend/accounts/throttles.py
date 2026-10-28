"""Rate limits beyond DRF's per-IP login throttle. Counts live in the default cache (CACHE_URL; shared in production)."""
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class FailedLoginsPerUsername(SimpleRateThrottle):
    """Failed logins per username tried (any IP), so guesses spread over many addresses still hit a limit.
    Only failures count: LoginView calls `failed()` / `succeeded()`; a correct password clears the count."""
    scope = 'login_user'

    def get_cache_key(self, request, view):
        username = str(request.data.get('username', '')).strip().lower()
        return self.cache_format % {'scope': self.scope, 'ident': username} if username else None

    def allow_request(self, request, view):
        if self.rate is None:
            return True
        self.key = self.get_cache_key(request, view)
        if self.key is None:
            return True
        self.history = self.cache.get(self.key, [])
        self.now = self.timer()
        while self.history and self.history[-1] <= self.now - self.duration:
            self.history.pop()
        return len(self.history) < self.num_requests or self.throttle_failure()

    def failed(self, request, view):
        key = self.get_cache_key(request, view)
        if key:
            history = [t for t in self.cache.get(key, []) if t > self.timer() - self.duration]
            self.cache.set(key, [self.timer(), *history], self.duration)

    def succeeded(self, request, view):
        key = self.get_cache_key(request, view)
        if key:
            self.cache.delete(key)


class PasswordChangeThrottle(UserRateThrottle):
    """Change-password attempts per user (each one checks the current password)."""
    scope = 'password'


class ExportThrottle(UserRateThrottle):
    """Report / workbook downloads per user (each one builds the whole file)."""
    scope = 'export'
