# Docs Placement — Mọi file .md phải nằm đúng chỗ trong `docs/`

> **Level:** MANDATORY.
> **Rule:** Khi AI tạo bất kỳ file `.md` nào cho dự án (report, plan, spec, guide, note, analysis,
> design doc...) → **PHẢI** đặt trong thư mục `docs/` ở gốc dự án, vào đúng **nhóm con** tương ứng.
> **Cấm** vứt file `.md` rải rác khắp nơi (cạnh code, ở root, trong thư mục ngẫu nhiên).

---

## Cấu trúc chuẩn — `docs/` ở gốc dự án

```
docs/
├── README.md            # index: liệt kê mọi doc + 1 dòng mô tả (luôn cập nhật)
├── 01-tong-quan/        # overview: mục tiêu, phạm vi, kiến trúc tổng
├── 02-ky-thuat/         # technical: API, DB, tech decision, integration, ARCHITECTURE
├── 03-san-pham/         # product: PRD, spec, user story, feature, business case
├── 04-van-hanh/         # operations: deploy, runbook, incident, backup, monitoring
├── 05-mau/              # mẫu / templates: doc mẫu, form, checklist tái sử dụng
├── 06-design/           # design: UI/UX, wireframe, design system, flow, diagram
└── 99-ghi-chu/          # notes: nháp, ghi chú nhanh, meeting, lặt vặt chưa phân loại
```

> Nhóm con dùng **prefix số** (`01-`, `02-`... `99-`) để sort ổn định. `99-ghi-chu` luôn cuối.
> Đây là bộ nhóm mặc định — nếu dự án đã có `docs/` với nhóm khác thì **theo nhóm hiện có**, không
> tự đổi tên.

---

## Quyết định: file này vào nhóm nào?

| Loại nội dung .md | Nhóm |
|---|---|
| Tổng quan dự án, mục tiêu, kiến trúc tổng, README con | `01-tong-quan/` |
| API spec, schema DB, quyết định kỹ thuật, integration, ARCHITECTURE.md, security | `02-ky-thuat/` |
| PRD, spec tính năng, user story, business case, requirement | `03-san-pham/` |
| Roadmap + changelog (xem [roadmap-sync.md](roadmap-sync.md)) | `03-san-pham/roadmap.md`, `03-san-pham/changelog.md` |
| Quy trình nghiệp vụ do `/business-flow` sinh ra (`QT-<nn>-<slug>.md`) | `03-san-pham/flows/` |
| Hướng dẫn deploy, runbook sự cố, backup, CI/CD, monitoring, vận hành | `04-van-hanh/` |
| Template / doc mẫu / checklist tái dùng | `05-mau/` |
| UI/UX, wireframe, design system, sơ đồ, user flow | `06-design/` |
| Nháp, ghi chú nhanh, biên bản họp, chưa rõ phân loại | `99-ghi-chu/` |

> Không chắc → hỏi user 1 câu ngắn nhóm nào; nếu vẫn không rõ → `99-ghi-chu/`, KHÔNG để ở root.

---

## Naming file trong docs

- **kebab-case**, có ý nghĩa: `payment-webhook-flow.md`, `q3-onboarding-spec.md`.
- Không dấu tiếng Việt, không khoảng trắng trong tên file.
- Có yếu tố thời gian → prefix ISO date: `2026-09-23-incident-db-down.md`.
- Không đặt tên chung chung vô nghĩa: `note.md`, `doc.md`, `new.md`, `untitled.md`.

---

## NGOẠI LỆ — KHÔNG ép vào `docs/`

Những file `.md` sau **giữ nguyên vị trí**, tuyệt đối không di chuyển vào `docs/`:

- `README.md` ở **gốc dự án** (và README của từng package/module — thuộc về code, đặt cạnh code).
- `CLAUDE.md`, `CLAUDE.local.md`.
- Toàn bộ `.claude/**` — skills (`SKILL.md`), rules, commands, references, agents, plans. Đây là
  **instruction files**, đặt sai chỗ là hỏng cơ chế nạp context.
- File convention của tool/community ở gốc: `LICENSE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- File `.md` mà một tool/framework yêu cầu ở path cố định (vd docs site generator).
- `backend/README.md`, `backend/CHAT.md` và `backend/docs/*.md` - tài liệu riêng của backend Go, đặt cạnh code (như README của package/module).
- Migration / schema `.sql` (`infra/db/migrations/`, `infra/db/schema.sql`, `infra/db/baseline.sql`) và file
  `.xlsx` nhúng vào server (`backend/internal/modules/categories/assets/mau-nhap-hang-loat.xlsx`,
  `backend/internal/modules/estimates/assets/mau-nhap-cong-tac.xlsx`) không phải tài liệu - giữ nguyên chỗ.

> Nghi ngờ 1 file có phải instruction/convention-fixed không → **giữ nguyên chỗ cũ + hỏi user**,
> không tự chuyển.

---

## Quy trình khi AI tạo 1 file .md mới

1. Nội dung này có phải diễn giải/report/spec/note cho **con người đọc** không? Nếu chỉ là
   docstring/README-cạnh-code → không thuộc rule này.
2. Có rơi vào **Ngoại lệ** ở trên không? → giữ nguyên chỗ quy định.
3. Còn lại → chọn nhóm theo bảng → tạo tại `docs/<nhóm>/<kebab-name>.md`.
4. `docs/` hoặc nhóm con chưa tồn tại → **tạo mới thư mục** rồi mới đặt file.
5. Thêm 1 dòng vào `docs/README.md`: `- [Tên](nhóm/file.md) — mô tả 1 câu`. Chưa có
   `docs/README.md` → tạo với danh sách nhóm + index.
6. Báo user đúng 1 dòng: đã đặt file ở đâu.

---

## Anti-patterns

- Tạo `.md` ở gốc dự án (ngoài các file ngoại lệ) → rác root, khó tìm.
- Rải `.md` cạnh file code (`src/foo/notes.md`, `internal/plan.md`) → phân mảnh, không ai thấy.
- Bịa nhóm mới mỗi lần tạo file → `docs/random/`, `docs/temp/`, `docs/misc2/`.
- Chuyển nhầm file trong `.claude/` hoặc README-cạnh-code vào `docs/` → phá cơ chế / mất ngữ cảnh.
- Tên file vô nghĩa (`note.md`, `untitled.md`) → không tra được.
- Tạo file xong quên cập nhật `docs/README.md` index.
- Tự ý gom/di chuyển hàng loạt doc cũ đang nằm rải rác khi user **không** yêu cầu — chỉ áp rule cho
  file **mới tạo**; dọn doc cũ là một việc riêng, cần user duyệt.

---

## Checklist trước khi ghi 1 file .md

- [ ] Không phải file ngoại lệ (README gốc, CLAUDE.md, `.claude/**`, LICENSE/CHANGELOG...)?
- [ ] Đã chọn đúng nhóm `docs/NN-.../` theo bảng?
- [ ] Tên kebab-case có nghĩa, không dấu, không khoảng trắng?
- [ ] Đã tạo thư mục `docs/`/nhóm con nếu chưa có?
- [ ] Đã thêm 1 dòng index vào `docs/README.md`?
