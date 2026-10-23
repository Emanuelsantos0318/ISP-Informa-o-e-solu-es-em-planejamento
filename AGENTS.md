<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Architecture rules

- Business rules live as pure, tested functions in `src/lib/rules/*` (service suggestion, stock status, reorder, expiry); UI never re-implements them — keeps dashboard, planning and alerts consistent.
- Operational configuration (services, exit types, time ranges, units) lives in `src/lib/config/*`; display labels are separate from the stored codes — prepares for a settings table and avoids storing UI text.
- All dates/times go through `src/lib/datetime.ts` (America/Bahia) — a single timezone source avoids off-by-one-day bugs.
- The app shell (sidebar + header) wraps `<Outlet />` in `__root.tsx`; navigation items come from `src/lib/navigation.ts` — one source for menu and page titles.
- Entry/exit modals are only opened via `MovementActions`; dashboard and Movimentações share it — no parallel flows.
- Contextual product creation renders `ProductFormDialog` inside the parent movement dialog's content so the movement form stays mounted and its data preserved.
- Anything that needs the database shows `BackendNotice` and never pretends to save — the spec forbids fake functionality.
- tsconfig uses `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`: optional props are typed `?: T | undefined`, and form errors use `FieldErrors<T>`.
