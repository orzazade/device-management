# GOALS — Device Management (working name)

Internal tool for Azercell QA: a lending library for physical test devices
(phones, tablets). Find a device, request it for a time range, get approval,
hand it over, return it. Full audit trail.

Scale: ~100 devices, ~100 users. One company, internal only.
Built first on our own hosting (scifilab K3s); moves to Azercell infra later.
No deadline; quality over speed.

## Users and roles

- **Admin** — sees all, can do all, final approval gate. (Was "Super Approver".)
- **Manager** — manages devices (add, edit, import from Excel), approves requests,
  can request on behalf of a user, can override booking time ranges.
- **Tester** — regular user. Searches devices, creates requests, holds devices.

Devices may sit with an admin/manager or on someone's desk. The approver is a
user too, so a device's keeper can be an admin or a boss — handover works the
same either way: from whoever holds it to whoever is approved.

## Core flow: request → approve → handover → return

1. Requester searches devices (by brand, OS + OS version, specs, status).
   Devices assigned to someone else are still visible and requestable.
2. Request = device + reason + requested time range.
3. **Policy at launch: every request needs approval.** Approval mode is a
   config flag, not hard-coded — later it can flip to "free devices
   auto-approve" without a rewrite.
4. On approve, the device is assigned to the requester; the previous holder
   is notified and confirms the physical handover.
5. Return: due date from the time range; overdue reminders; check-in step
   verifies accessories against the device's accessory list.
6. Every change (approve, reject, time override, handover, return) is
   audit-logged: who, what, when, old → new value.

## Entities (first cut)

- **Device**: brand, model, OS + OS version, specs, serial/IMEI, status
  (available / assigned / in repair / retired), damage status, current holder,
  assigned project, accessories list (box, cable, charger, ...).
- **Project**: separate entity; devices can be attached to one.
- **Request**: device, requester, reason, time range, state
  (pending / approved / rejected / active / returned / overdue), audit trail.
- **Repair**: separate lifecycle — reported damage → repair request →
  in repair → fixed/written off.
- **User**: from auth (simple login first, Azercell LDAP/AD later — auth must
  be a pluggable layer from day one).

## Notifications

- In-app + email. Email = plain SMTP first; Azercell Exchange later.
- Per-event channel config: for each event type (request created, approved,
  handover pending, due soon, overdue, repair update) choose in-app,
  email, or both.

## Device intake

- Manual add form.
- Excel import (bulk). Import errors must be loud and row-by-row — a silent
  partial import is worse than a failed one.

## Later / nice-to-have (not v1)

- QR sticker per device; scan to confirm handover and return.
- Waitlist when a device is busy; auto-notify when free.
- Idle-device report (unused 90 days) and usage analytics.
- Auto-approve policy for free devices (flag exists in v1, defaulted off).

## Non-goals

- Remote device control / device farm (Kobiton-style racks). Physical only.
- General IT asset management (laptops, licenses). Test devices only.
- Multi-company / SaaS. One tenant, internal.

## Why build, not buy

Snipe-IT (free) lacks time-range booking and approval chains. Cheqroom/Reftab
do bookings but are paid foreign cloud — a telecom can't put inventory there.
The exact combo (physical handover + booking + approvals + on-prem + AD) has
no good free tool. Researched 2026-08-24.
