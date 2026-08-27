"""Thin REST client used only to SEED and INSPECT state around the UI tests.

Rule of thumb for this suite: the UI is the thing under test, so every
assertion that matters happens in the browser. The API is used for two
supporting jobs only:

  * arranging preconditions cheaply (a project, a device, a tester account)
  * reading back the truth after a UI action, so a green test means the
    backend really changed and not just that a toast appeared
"""

from __future__ import annotations

import requests


class ApiError(AssertionError):
    """Raised when a seeding call fails — that is a broken fixture, not a bug."""


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.token: str | None = None

    # ---------------------------------------------------------------- plumbing

    def _headers(self) -> dict[str, str]:
        h = {"content-type": "application/json"}
        if self.token:
            h["authorization"] = f"Bearer {self.token}"
        return h

    def request(self, method: str, path: str, **kwargs):
        url = f"{self.base}{path}"
        res = requests.request(method, url, headers=self._headers(), timeout=20, **kwargs)
        if not res.ok:
            raise ApiError(f"{method} {path} -> {res.status_code}: {res.text[:400]}")
        return res.json() if res.content else None

    def get(self, path: str):
        return self.request("GET", path)

    def post(self, path: str, body: dict | None = None):
        return self.request("POST", path, json=body or {})

    def delete(self, path: str):
        """DELETE with no body.

        `_headers()` always sets a JSON content-type, and Fastify refuses a
        request that declares one and then sends nothing — so the header is
        dropped for bodyless deletes.
        """
        headers = {k: v for k, v in self._headers().items() if k != "content-type"}
        res = requests.delete(f"{self.base}{path}", headers=headers, timeout=20)
        if not res.ok:
            raise ApiError(f"DELETE {path} -> {res.status_code}: {res.text[:400]}")
        return res.json() if res.content else None

    # ------------------------------------------------------------------- auth

    def login(self, email: str, password: str) -> dict:
        """Log in and keep the token for subsequent calls."""
        res = requests.post(
            f"{self.base}/auth/login",
            json={"email": email, "password": password},
            timeout=20,
        )
        if not res.ok:
            raise ApiError(f"login as {email} failed -> {res.status_code}: {res.text[:400]}")
        data = res.json()
        self.token = data["token"]
        return data

    def as_user(self, email: str, password: str) -> "Api":
        """A second client bound to another account, so a fixture can act as
        the tester without disturbing the admin session."""
        other = Api(self.base)
        other.login(email, password)
        return other

    # ------------------------------------------------------------------ seeds

    def create_user(self, name: str, email: str, password: str, role: str) -> dict:
        return self.post("/users", {"name": name, "email": email, "password": password, "role": role})

    def find_user_by_email(self, email: str) -> dict | None:
        for u in self.users():
            if u["email"].lower() == email.lower():
                return u
        return None

    def update_user(self, user_id: str, **fields) -> dict:
        return self.request("PATCH", f"/users/{user_id}", json=fields)

    def set_role(self, user_id: str, role: str) -> dict:
        return self.request("PATCH", f"/users/{user_id}/role", json={"role": role})

    def ensure_user(self, name: str, email: str, password: str, role: str) -> dict:
        """Get-or-create a fixed test account, reset to a known-good state.

        The suite reuses a small set of permanent accounts instead of minting
        new ones per run — otherwise every run adds three rows to the real
        user list, which is noise for whoever actually administers the lab.
        Password, role and active flag are reset each time so a test that
        changes one of them cannot poison the next run.
        """
        existing = self.find_user_by_email(email)
        if existing is None:
            return self.create_user(name, email, password, role)
        self.update_user(existing["id"], newPassword=password, active=True)
        if existing["role"] != role:
            self.set_role(existing["id"], role)
        return {**existing, "role": role}

    def create_project(self, name: str, description: str = "") -> dict:
        return self.post("/projects", {"name": name, "description": description})

    def create_device(self, **fields) -> dict:
        return self.post("/devices", fields)

    def create_request(
        self,
        device_id: str,
        project_id: str,
        reason: str,
        from_date: str,
        to_date: str,
    ) -> dict:
        return self.post(
            "/requests",
            {
                "deviceId": device_id,
                "projectId": project_id,
                "reason": reason,
                "fromDate": from_date,
                "toDate": to_date,
            },
        )

    def approve(self, request_id: str) -> dict:
        return self.post(f"/requests/{request_id}/approve")

    def handover(self, request_id: str) -> dict:
        return self.post(f"/requests/{request_id}/handover")

    def report_damage(self, device_id: str, issue: str) -> dict:
        return self.post("/repairs", {"deviceId": device_id, "issue": issue})

    # --------------------------------------------------------------- read-back

    def device(self, device_id: str) -> dict:
        return self.get(f"/devices/{device_id}")

    def devices(self, query: str = "") -> list[dict]:
        return self.get(f"/devices{query}")

    def find_device_by_serial(self, serial: str) -> dict | None:
        for d in self.devices(f"?q={serial}"):
            if d["serial"] == serial:
                return d
        return None

    def requests_all(self) -> list[dict]:
        return self.get("/requests?scope=all")

    def find_request_for_device(self, device_id: str) -> dict | None:
        """First request touching a device.

        Only safe while a device has exactly one request — a device that has
        been requested twice needs `request_by_id`.
        """
        for r in self.requests_all():
            if r["device"]["id"] == device_id:
                return r
        return None

    def request_by_id(self, request_id: str) -> dict | None:
        for r in self.requests_all():
            if r["id"] == request_id:
                return r
        return None

    def users(self) -> list[dict]:
        return self.get("/users")

    def repairs(self) -> list[dict]:
        return self.get("/repairs")

    def find_repair_for_device(self, device_id: str) -> dict | None:
        for r in self.repairs():
            if r["device"]["id"] == device_id:
                return r
        return None

    def settings(self) -> dict:
        return self.get("/settings")

    def set_approval_mode(self, mode: str) -> dict:
        return self.request("PATCH", "/settings/approval-mode", json={"mode": mode})

    def notification_rules(self) -> list[dict]:
        return self.get("/notification-rules")

    def audit(self, query: str = "?limit=100") -> list[dict]:
        return self.get(f"/audit{query}")
