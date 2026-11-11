package server

// Tài liệu API (Swagger UI) - bản chuyển của server/swagger.js:  GET /api-docs  (spec thô: /api-docs.json).
//   - Danh sách hàm + quyền lấy từ registry của bản Go; mô tả tham số lấy từ apidocs/api-docs.json
//     (bản chép của server/api-docs.json, đóng băng từ khi gỡ app Node).
//   - Phần /api/<fn> và 9 route lẻ dựng giống hệt bản Node; bản Go thêm các route REST /api/v1.
//   - Giao diện Swagger UI nhúng sẵn trong file chạy (github.com/swaggo/files/v2), không gọi CDN.

import (
	_ "embed"
	"html"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files/v2"

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

//go:embed apidocs/api-docs.json
var apiDocsJSON []byte

//go:embed apidocs/meta.json
var apiMetaJSON []byte

const (
	tagKhac = "Khác"
	tagFile = "Tải file & upload"
	tagHeTh = "Hệ thống"
	tagREST = "REST - "
	mimeXLS = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

// swaggerEnabled = enabled_(): bật mặc định khi chạy ở máy; NODE_ENV=production phải đặt SWAGGER_DOCS=1 mới mở;
// SWAGGER_DOCS=0 tắt hẳn.
func swaggerEnabled(swaggerDocs, nodeEnv string) bool {
	if swaggerDocs == "0" {
		return false
	}
	return swaggerDocs == "1" || nodeEnv != "production"
}

// apiDocs đọc mô tả nhúng: docs[fn] = {tag, summary, args, returns}; order = thứ tự hàm trong REGISTRY của Node.
func apiDocs() (docs *omap.Map, order []string, version string) {
	if v, err := omap.Decode(apiDocsJSON); err == nil {
		docs = jsval.AsMap(v)
	}
	if v, err := omap.Decode(apiMetaJSON); err == nil {
		m := jsval.AsMap(v)
		version = jsval.Str(m.Val("version"))
		for _, n := range jsval.AsArray(m.Val("order")) {
			order = append(order, jsval.Str(n))
		}
	}
	return docs, order, version
}

// fnOrder: tên hàm đã đăng ký theo thứ tự REGISTRY của Node; hàm chỉ có ở bản Go xếp sau theo chữ cái.
func fnOrder(reg *rpc.Registry, order []string) []string {
	out := make([]string, 0, len(order))
	seen := map[string]bool{}
	for _, n := range order {
		if reg.Has(n) && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	for _, n := range reg.Names() {
		if !seen[n] {
			out = append(out, n)
		}
	}
	return out
}

func quyen(p rpc.Perm) string {
	switch {
	case p&rpc.Public != 0:
		return "Công khai (không cần đăng nhập)"
	case p&rpc.SelfAuth != 0:
		return "Phiên chat riêng: `Authorization: Bearer <access_token>` do `/api/v1/chat/auth/otp/verify` cấp (không phải phiên QS)"
	case p&rpc.Super != 0:
		return "Chỉ quản trị hệ thống (super)"
	case p&rpc.Admin != 0:
		return "Chỉ Admin / super"
	}
	return "Cần đăng nhập"
}

func loiResp(moTa string) *omap.Map {
	return omap.Of("description", moTa, "content", omap.Of("application/json",
		omap.Of("schema", omap.Of("$ref", "#/components/schemas/Loi"))))
}

func security(isPublic bool) []any {
	if isPublic {
		return []any{}
	}
	return []any{omap.Of("bearerAuth", []any{})}
}

// argsOf: mô tả tham số của hàm. Bản Node lấy tên tham số từ mã nguồn khi api-docs.json chưa mô tả;
// bản Go không có mã nguồn đó nên hàm chưa mô tả coi như không có tham số.
func argsOf(docs *omap.Map, fn string) []any {
	return jsval.AsArray(jsval.AsMap(docs.Val(fn)).Val("args"))
}

// argLine: một dòng mô tả tham số, viết như rpcPath_ của Node.
func argLine(i int, a *omap.Map) string {
	s := strconv.Itoa(i+1) + ". `" + jsval.ToString(a.Val("name")) + "`"
	if jsval.Truthy(a.Val("type")) {
		s += " (" + jsval.ToString(a.Val("type"))
		if jsval.Truthy(a.Val("required")) {
			s += ", bắt buộc"
		}
		s += ")"
	}
	if jsval.Truthy(a.Val("description")) {
		s += " - " + jsval.ToString(a.Val("description"))
	}
	return s
}

func exampleOf(a *omap.Map) any {
	if v, ok := a.Get("example"); ok && !jsval.IsUndefined(v) {
		return v
	}
	return nil
}

// stdResponses: 200 / 500, thêm 401 khi cần đăng nhập và 403 khi cần quyền admin / super.
func stdResponses(p rpc.Perm, moTa500 string) *omap.Map {
	r := omap.Of(
		"200", omap.Of("description", "Thành công", "content", omap.Of("application/json",
			omap.Of("schema", omap.Of("$ref", "#/components/schemas/KetQua")))),
		"500", loiResp(moTa500),
	)
	if p&rpc.SelfAuth != 0 {
		r.Set("401", loiResp("Thiếu / sai / hết hạn access token của chat (`code: \"CHAT_NOAUTH\"`)"))
	} else if p&rpc.Public == 0 {
		r.Set("401", loiResp("Chưa đăng nhập / phiên hết hạn (`code: \"NOAUTH\"`)"))
		if p&(rpc.Admin|rpc.Super) != 0 {
			r.Set("403", loiResp("Không đủ quyền"))
		}
	}
	return r
}

// rpcPath = rpcPath_(fn, handler, o).
func rpcPath(docs *omap.Map, fn string, p rpc.Perm) (*omap.Map, string) {
	d := jsval.AsMap(docs.Val(fn))
	args := argsOf(docs, fn)
	isPublic := p&rpc.Public != 0
	desc := "**Quyền:** " + quyen(p)
	if len(args) > 0 {
		lines := make([]string, len(args))
		for i, a := range args {
			lines[i] = argLine(i, jsval.AsMap(a))
		}
		desc += "\n\n**args** (theo đúng thứ tự):\n" + strings.Join(lines, "\n")
	} else {
		desc += "\n\n**args:** không có - gửi `{\"args\": []}`."
	}
	if jsval.Truthy(d.Val("returns")) {
		desc += "\n\n**Trả về** (trong `result`): " + jsval.ToString(d.Val("returns"))
	}
	ex := make([]any, len(args))
	for i, a := range args {
		ex[i] = exampleOf(jsval.AsMap(a))
	}
	tag := jsval.Or(d.Val("tag"), tagKhac)
	op := omap.Of(
		"tags", []any{tag},
		"operationId", fn,
		"summary", jsval.Or(d.Val("summary"), fn),
		"description", desc,
		"security", security(isPublic),
		"requestBody", omap.Of(
			"required", true,
			"content", omap.Of("application/json", omap.Of(
				"schema", omap.Of("type", "object", "properties", omap.Of("args",
					omap.Of("type", "array", "items", omap.New(), "description", "Tham số của hàm, theo thứ tự"))),
				"example", omap.Of("args", ex),
			)),
		),
		"responses", stdResponses(p, "Hàm báo lỗi (thông báo nằm ở `error`)"),
	)
	return omap.Of("post", op), jsval.ToString(tag)
}

// routeLe = routeLe_(): các route lẻ (tải file / upload), khai tay vì không đi qua /api/:fn.
func routeLe() *omap.Map {
	sec := security(false)
	file := func(moTa string) *omap.Map {
		return omap.Of("description", moTa, "content", omap.Of(mimeXLS,
			omap.Of("schema", omap.Of("type", "string", "format", "binary"))))
	}
	jsonBody := func(props *omap.Map, example any) *omap.Map {
		return omap.Of("required", true, "content", omap.Of("application/json",
			omap.Of("schema", omap.Of("type", "object", "properties", props), "example", example)))
	}
	arrObj := func() *omap.Map { return omap.Of("type", "array", "items", omap.Of("type", "object")) }
	hm := omap.Of("name", "hm", "in", "query", "required", false, "schema", omap.Of("type", "string"),
		"description", "Tên hạng mục - chỉ lấy cột của hạng mục đó")
	mau := func(ten string, params ...any) *omap.Map {
		if params == nil {
			params = []any{}
		}
		return omap.Of("get", omap.Of("tags", []any{tagFile}, "summary", "File mẫu nhập hàng loạt - "+ten,
			"security", []any{}, "parameters", params, "responses", omap.Of("200", file("File .xlsx"))))
	}
	return omap.Of(
		"/export/san-pham", omap.Of("post", omap.Of("tags", []any{tagFile}, "summary", "Xuất Excel danh sách sản phẩm", "security", sec,
			"description", "Bỏ trống `keys` -> xuất toàn bộ sản phẩm của công ty đang đăng nhập.",
			"requestBody", jsonBody(omap.Of("keys", omap.Of("type", "array", "items", omap.Of("type", "string"),
				"description", "recordId hoặc mã SP cần xuất")), omap.Of("keys", []any{})),
			"responses", omap.Of("200", file("File .xlsx (header `X-Row-Count` = số dòng)"), "401", loiResp("Chưa đăng nhập")))),
		"/export/cong-tac", omap.Of("post", omap.Of("tags", []any{tagFile}, "summary", "Xuất Excel danh sách công tác xây dựng (Phần thô)", "security", sec,
			"description", "Client gửi thẳng các dòng đang xem (tối đa 5000), server chỉ dựng file.",
			"requestBody", jsonBody(omap.Of("rows", arrObj()),
				omap.Of("rows", []any{omap.Of("stt", 1.0, "loai", "Phần thô", "hangMuc", "Móng", "noiDung", "Đào đất hố móng", "dvt", "m3",
					"khoiLuong", 12.5, "dienTich", "", "heSo", 1.0, "dgnt", 150000.0, "dg", 180000.0, "ghiChu", "")})),
			"responses", omap.Of("200", file("File .xlsx"), "400", loiResp("Không có dòng nào để xuất"), "401", loiResp("Chưa đăng nhập")))),
		"/export/bang", omap.Of("post", omap.Of("tags", []any{tagFile}, "summary", "Xuất 1 bảng do client dựng sẵn ra Excel", "security", sec,
			"requestBody", jsonBody(omap.Of("ten", omap.Of("type", "string"), "sheet", omap.Of("type", "string"),
				"cols", omap.Of("type", "array", "items", omap.Of("type", "object"), "description", "[{label, num}]"),
				"rows", omap.Of("type", "array", "items", omap.Of("type", "object"), "description", "[{cells:[...]}] hoặc [{group:\"...\"}]"),
				"tong", omap.Of("type", "array", "items", omap.New(), "description", "[[nhãn, số]]")),
				omap.Of("ten", "Bảng tính", "sheet", "Bang",
					"cols", []any{omap.Of("label", "Tên"), omap.Of("label", "Thành tiền", "num", true)},
					"rows", []any{omap.Of("cells", []any{"Đèn LED", 1200000.0})},
					"tong", []any{[]any{"Tổng cộng", 1200000.0}})),
			"responses", omap.Of("200", file("File .xlsx"), "400", loiResp("Không có cột nào để xuất"), "401", loiResp("Chưa đăng nhập")))),
		"/upload/file", omap.Of("post", omap.Of("tags", []any{tagFile}, "summary", "Tải file tài liệu lên (nhị phân)", "security", sec,
			"description", "Body là nội dung file (không base64), tên gốc truyền qua `?name=`.",
			"parameters", []any{omap.Of("name", "name", "in", "query", "required", true, "schema", omap.Of("type", "string"),
				"description", "Tên file gốc, vd catalogue.pdf")},
			"requestBody", omap.Of("required", true, "content", omap.Of("application/octet-stream",
				omap.Of("schema", omap.Of("type", "string", "format", "binary")))),
			"responses", omap.Of(
				"200", omap.Of("description", "Thông tin file đã lưu", "content", omap.Of("application/json", omap.Of("schema", omap.Of("type", "object")))),
				"400", loiResp("File không hợp lệ"), "401", loiResp("Chưa đăng nhập"), "413", loiResp("File quá lớn")))),
		"/media", omap.Of("get", omap.Of("tags", []any{tagFile}, "summary", "Proxy ảnh cũ lưu trên Lark", "security", []any{},
			"parameters", []any{omap.Of("name", "token", "in", "query", "required", true, "schema", omap.Of("type", "string"),
				"description", "file_token của Lark")},
			"responses", omap.Of("200", omap.Of("description", "Nội dung ảnh"), "400", omap.Of("description", "Thiếu token"),
				"502", omap.Of("description", "Không tải được ảnh")))),
		"/mau-nhap-thiet-bi-ve-sinh.xlsx", mau("Thiết bị vệ sinh"),
		"/mau-nhap-cong-tac-o-cam.xlsx", mau("Công tắc - Ổ cắm", hm),
		"/mau-nhap-son-nuoc.xlsx", mau("Sơn nước", hm),
		"/healthz", omap.Of("get", omap.Of("tags", []any{tagHeTh}, "summary", "Kiểm tra server còn sống", "security", []any{},
			"responses", omap.Of("200", omap.Of("description", "`{ \"ok\": true }`")))),
	)
}

// schemaOf: schema OpenAPI của một tham số theo `type` ghi trong api-docs.json.
func schemaOf(a *omap.Map) *omap.Map {
	switch t := jsval.Str(a.Val("type")); t {
	case "array":
		return omap.Of("type", "array", "items", omap.New())
	case "string", "number", "integer", "boolean", "object":
		return omap.Of("type", t)
	}
	return omap.New()
}

// openAPIPath đổi đường dẫn gin (/projects/:id) sang OpenAPI (/api/v1/projects/{id}) và trả tên các tham số.
func openAPIPath(p string) (string, []string) {
	segs := strings.Split(p, "/")
	var names []string
	for i, s := range segs {
		if strings.HasPrefix(s, ":") {
			names = append(names, s[1:])
			segs[i] = "{" + s[1:] + "}"
		}
	}
	return "/api/v1" + strings.Join(segs, "/"), names
}

// restOp: mô tả một route REST từ mô tả của hàm rpc tương ứng.
//   - tham số đường dẫn = các tham số đầu của hàm, theo thứ tự;
//   - GET / DELETE: tham số còn lại nằm ở query string;
//   - method khác: còn đúng 1 tham số kiểu object thì THÂN chính là object đó, ngược lại thân là object
//     có khoá trùng tên tham số (đúng cách các handler REST đọc).
func restOp(docs *omap.Map, rt RestRoute, p rpc.Perm, pathParams []string) *omap.Map {
	d := jsval.AsMap(docs.Val(rt.Fn))
	args := argsOf(docs, rt.Fn)
	isPublic := p&rpc.Public != 0
	params := []any{}
	for i, name := range pathParams {
		prm := omap.Of("name", name, "in", "path", "required", true, "schema", omap.Of("type", "string"))
		if i < len(args) {
			a := jsval.AsMap(args[i])
			moTa := "Tham số `" + jsval.ToString(a.Val("name")) + "` của hàm"
			if jsval.Truthy(a.Val("description")) {
				moTa += " - " + jsval.ToString(a.Val("description"))
			}
			prm.Set("description", moTa)
			if ex := exampleOf(a); ex != nil && !jsval.IsObject(ex) && !jsval.IsArray(ex) {
				prm.Set("example", jsval.ToString(ex))
			}
		}
		params = append(params, prm)
	}
	var rest []any
	if len(pathParams) < len(args) {
		rest = args[len(pathParams):]
	}
	desc := "**Quyền:** " + quyen(p) + "\n\nGọi cùng nghiệp vụ với hàm RPC `POST /api/" + rt.Fn + "`."
	var body *omap.Map
	if rt.Method == http.MethodGet || rt.Method == http.MethodDelete {
		for _, x := range rest {
			a := jsval.AsMap(x)
			prm := omap.Of("name", jsval.ToString(a.Val("name")), "in", "query", "required", jsval.Truthy(a.Val("required")),
				"schema", schemaOf(a))
			if jsval.Truthy(a.Val("description")) {
				prm.Set("description", a.Val("description"))
			}
			if ex := exampleOf(a); ex != nil {
				prm.Set("example", ex)
			}
			params = append(params, prm)
		}
	} else if len(rest) == 1 && jsval.Str(jsval.AsMap(rest[0]).Val("type")) == "object" {
		a := jsval.AsMap(rest[0])
		schema := omap.Of("type", "object")
		if jsval.Truthy(a.Val("description")) {
			schema.Set("description", a.Val("description"))
		}
		content := omap.Of("schema", schema)
		if ex := exampleOf(a); ex != nil {
			content.Set("example", ex)
		}
		body = omap.Of("required", true, "content", omap.Of("application/json", content))
		desc += "\n\n**Thân JSON** chính là tham số `" + jsval.ToString(a.Val("name")) + "` của hàm."
	} else if len(rest) > 0 {
		props, ex := omap.New(), omap.New()
		lines := make([]string, len(rest))
		for i, x := range rest {
			a := jsval.AsMap(x)
			name := jsval.ToString(a.Val("name"))
			sc := schemaOf(a)
			if jsval.Truthy(a.Val("description")) {
				sc.Set("description", a.Val("description"))
			}
			props.Set(name, sc)
			ex.Set(name, exampleOf(a))
			lines[i] = argLine(i, a)
		}
		body = omap.Of("required", true, "content", omap.Of("application/json",
			omap.Of("schema", omap.Of("type", "object", "properties", props), "example", ex)))
		desc += "\n\n**Thân JSON** (object, khoá trùng tên tham số):\n" + strings.Join(lines, "\n")
	}
	if jsval.Truthy(d.Val("returns")) {
		desc += "\n\n**Trả về** (trong `result`): " + jsval.ToString(d.Val("returns"))
	}
	op := omap.Of(
		"tags", []any{tagREST + jsval.ToString(jsval.Or(d.Val("tag"), tagKhac))},
		"operationId", "v1_"+rt.Fn,
		"summary", jsval.Or(d.Val("summary"), rt.Fn),
		"description", desc,
		"security", security(isPublic),
		"parameters", params,
	)
	if body != nil {
		op.Set("requestBody", body)
	}
	op.Set("responses", stdResponses(p, "Nghiệp vụ báo lỗi (thông báo nằm ở `error`)"))
	return op
}

// tagGoOnly: hậu tố nhóm tài liệu của route chỉ bản Go ("REST - <Tag> (chỉ bản Go)").
const tagGoOnly = " (chỉ bản Go)"

// goOp: mô tả một route chỉ bản Go từ GoRoute (không có hàm RPC tương ứng nên không đọc api-docs.json).
//   - Fields In "path" / "query" -> parameters; tham số đường dẫn chưa khai trong Fields vẫn được ghi (kiểu string);
//   - Fields In "body" -> thân JSON object, mỗi field là một khoá.
func goOp(g rpc.GoRoute, pathParams []string) *omap.Map {
	tag := g.Tag
	if tag == "" {
		tag = tagKhac
	}
	schema := func(f rpc.GoField) *omap.Map {
		if f.Type == "" {
			return omap.New()
		}
		return schemaOf(omap.Of("type", f.Type))
	}
	param := func(f rpc.GoField, required bool) *omap.Map {
		prm := omap.Of("name", f.Name, "in", f.In, "required", required, "schema", schema(f))
		if f.Desc != "" {
			prm.Set("description", f.Desc)
		}
		return prm
	}
	params := []any{}
	for _, name := range pathParams {
		f := rpc.GoField{Name: name, In: "path", Type: "string"}
		for _, x := range g.Fields {
			if x.In == "path" && x.Name == name {
				f = x
				if f.Type == "" {
					f.Type = "string"
				}
			}
		}
		params = append(params, param(f, true))
	}
	props := omap.New()
	var required []any
	var lines []string
	for _, f := range g.Fields {
		switch f.In {
		case "query":
			params = append(params, param(f, f.Required))
		case "body":
			sc := schema(f)
			if f.Desc != "" {
				sc.Set("description", f.Desc)
			}
			props.Set(f.Name, sc)
			line := "- `" + f.Name + "`"
			var bits []string
			if f.Type != "" {
				bits = append(bits, f.Type)
			}
			if f.Required {
				bits = append(bits, "bắt buộc")
				required = append(required, f.Name)
			}
			if len(bits) > 0 {
				line += " (" + strings.Join(bits, ", ") + ")"
			}
			if f.Desc != "" {
				line += " - " + f.Desc
			}
			lines = append(lines, line)
		}
	}
	desc := "**Quyền:** " + quyen(g.Perm) + "\n\nChỉ có ở bản Go: không có hàm RPC `POST /api/<tênHàm>` tương ứng."
	var body *omap.Map
	if props.Len() > 0 {
		sc := omap.Of("type", "object", "properties", props)
		if len(required) > 0 {
			sc.Set("required", required)
		}
		body = omap.Of("required", len(required) > 0, "content", omap.Of("application/json", omap.Of("schema", sc)))
		desc += "\n\n**Thân JSON** (object):\n" + strings.Join(lines, "\n")
	}
	summary := g.Summary
	if summary == "" {
		summary = g.Name
	}
	op := omap.Of(
		"tags", []any{tagREST + tag + tagGoOnly},
		"operationId", "v1go_"+g.Name,
		"summary", summary,
		"description", desc,
		"security", security(g.Perm&rpc.Public != 0),
		"parameters", params,
	)
	if body != nil {
		op.Set("requestBody", body)
	}
	op.Set("responses", stdResponses(g.Perm, "Nghiệp vụ báo lỗi (thông báo nằm ở `error`)"))
	return op
}

// BuildSpec = buildSpec(o) của Node, cộng thêm các route REST /api/v1 trong bảng RestRoutes
// và các route chỉ bản Go (reg.GoRoutes(), nhóm "REST - <Tag> (chỉ bản Go)", đặt sau nhóm REST thường).
func BuildSpec(reg *rpc.Registry) *omap.Map {
	docs, order, version := apiDocs()
	paths := omap.New()
	tags := []string{}
	addTag := func(list []string, t string) []string {
		for _, x := range list {
			if x == t {
				return list
			}
		}
		return append(list, t)
	}
	for _, fn := range fnOrder(reg, order) {
		p, _ := reg.PermOf(fn)
		item, tag := rpcPath(docs, fn, p)
		paths.Set("/api/"+fn, item)
		tags = addTag(tags, tag)
	}
	le := routeLe()
	le.Each(func(k string, v any) { paths.Set(k, v) })
	// nhóm 'Khác' luôn nằm sau các nhóm nghiệp vụ
	for i, t := range tags {
		if t == tagKhac {
			tags = append(append(tags[:i:i], tags[i+1:]...), tagKhac)
			break
		}
	}
	restTags := []string{}
	for _, rt := range RestRoutes {
		p, ok := reg.PermOf(rt.Fn)
		if !ok {
			continue
		}
		oaPath, names := openAPIPath(rt.Path)
		op := restOp(docs, rt, p, names)
		item := jsval.AsMap(paths.Val(oaPath))
		if item == nil {
			item = omap.New()
			paths.Set(oaPath, item)
		}
		item.Set(strings.ToLower(rt.Method), op)
		restTags = addTag(restTags, jsval.AsString(jsval.AsArray(op.Val("tags"))[0]))
	}
	goRoutes := reg.GoRoutes()
	for _, g := range goRoutes {
		oaPath, names := openAPIPath(g.Path)
		op := goOp(g, names)
		item := jsval.AsMap(paths.Val(oaPath))
		if item == nil {
			item = omap.New()
			paths.Set(oaPath, item)
		}
		item.Set(strings.ToLower(g.Method), op)
		restTags = addTag(restTags, jsval.AsString(jsval.AsArray(op.Val("tags"))[0]))
	}
	moTa := []string{
		"API nghiệp vụ là **RPC**: `POST /api/<tênHàm>` với body `{\"args\": [...]}` - các phần tử của `args` truyền theo thứ tự vào hàm.",
		"Kết quả: `{\"ok\": true, \"result\": ...}`; lỗi: `{\"error\": \"...\"}`.",
		"",
		"**Đăng nhập để thử:** gọi `login` -> lấy `token` trong `result` -> bấm **Authorize** và dán token.",
		"Tài khoản super có thể thêm header `x-view-company: <id công ty>` để xem như một công ty.",
		"",
		"> **Lưu ý:** \"Try it out\" gọi thẳng vào server này và ghi dữ liệu THẬT của database đang kết nối.",
		"",
		"Mỗi hàm RPC còn có một route **REST** tương ứng dưới `/api/v1` (các nhóm `REST - ...`), cùng nghiệp vụ và cùng dạng kết quả.",
	}
	if len(goRoutes) > 0 {
		// đặt SAU đoạn "Mỗi hàm RPC": test so với Node cắt mô tả từ đoạn đó
		moTa = append(moTa, "",
			"Các nhóm `REST - ..."+tagGoOnly+"` là route chỉ có ở bản Go (tính năng mới, không có hàm RPC tương ứng), cùng dạng kết quả.")
	}
	allTags := make([]any, 0, len(tags)+len(restTags)+2)
	for _, t := range append(append(tags, tagFile, tagHeTh), restTags...) {
		allTags = append(allTags, omap.Of("name", t))
	}
	return omap.Of(
		"openapi", "3.0.3",
		"info", omap.Of(
			"title", "QS Pro API",
			"version", version,
			"description", strings.Join(moTa, "\n"),
		),
		"servers", []any{omap.Of("url", "/")},
		"tags", allTags,
		"components", omap.Of(
			"securitySchemes", omap.Of("bearerAuth", omap.Of("type", "http", "scheme", "bearer", "description", "Token trả về từ hàm `login`")),
			"schemas", omap.Of(
				"KetQua", omap.Of("type", "object", "properties", omap.Of("ok", omap.Of("type", "boolean", "example", true),
					"result", omap.Of("description", "Giá trị hàm trả về (null nếu không có)"))),
				"Loi", omap.Of("type", "object", "properties", omap.Of("error", omap.Of("type", "string"),
					"code", omap.Of("type", "string", "description", "Chỉ có ở lỗi 401: NOAUTH"))),
			),
		),
		"paths", paths,
	)
}

// Trang Swagger UI: cùng tuỳ chọn với bản Node (customSiteTitle, persistAuthorization, docExpansion, filter).
const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>QS Pro API</title>
  <link rel="stylesheet" type="text/css" href="/api-docs/swagger-ui.css">
  <link rel="icon" type="image/png" href="/api-docs/favicon-32x32.png" sizes="32x32">
  <link rel="icon" type="image/png" href="/api-docs/favicon-16x16.png" sizes="16x16">
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
  </style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="/api-docs/swagger-ui-bundle.js"></script>
<script src="/api-docs/swagger-ui-standalone-preset.js"></script>
<script>
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/api-docs.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: 'StandaloneLayout',
    persistAuthorization: true,
    docExpansion: 'none',
    filter: true
  });
};
</script>
</body>
</html>
`

// mountSwagger = mount(app, o): gắn /api-docs.json và /api-docs khi được bật. Trả false khi tắt.
func (s *Server) mountSwagger() bool {
	cfg := s.deps.Cfg
	if !swaggerEnabled(cfg.SwaggerDocs, cfg.NodeEnv) {
		return false
	}
	spec, err := omap.Marshal(BuildSpec(s.deps.Reg))
	if err != nil {
		logger.Error("swagger", "không dựng được tài liệu API:", err.Error())
		return false
	}
	e := s.engine
	e.GET("/api-docs.json", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/json; charset=utf-8", spec)
	})
	return true
}

// swaggerUI = app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(...)) của Node, gọi từ noRoute (mount nằm sau
// mọi route). Khớp tiền tố không phân biệt hoa thường, MỌI method:
//   - đường dẫn kết thúc bằng /package.json -> 404 "Not Found" (swagger-ui-express chặn);
//   - GET /api-docs (thiếu "/" cuối) -> 301 sang /api-docs/ ; GET file của Swagger UI -> file;
//   - còn lại (kể cả POST, PUT...) -> trang Swagger UI.
//
// Trả false khi đường dẫn không thuộc /api-docs.
func (s *Server) swaggerUI(c *gin.Context) bool {
	raw := c.Request.URL.EscapedPath()
	const mount = "/api-docs"
	if len(raw) < len(mount) || !strings.EqualFold(raw[:len(mount)], mount) || (len(raw) > len(mount) && raw[len(mount)] != '/') {
		return false
	}
	sub := raw[len(mount):]
	page := func() { c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(swaggerHTML)) }
	if strings.HasSuffix(sub, "/package.json") {
		c.Data(http.StatusNotFound, "text/plain; charset=utf-8", []byte("Not Found"))
		return true
	}
	if c.Request.Method != http.MethodGet { // HEAD đã được noRoute đổi thành GET
		page()
		return true
	}
	if sub == "" {
		// serve-static chuyển /api-docs sang /api-docs/ rồi mới trả trang
		loc := raw + "/"
		if q := c.Request.URL.RawQuery; q != "" {
			loc += "?" + q
		}
		loc = encodeURL(loc)
		h := c.Writer.Header()
		h.Set("Content-Security-Policy", "default-src 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Location", loc)
		c.Data(http.StatusMovedPermanently, "text/html; charset=UTF-8", []byte("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"+
			"<meta charset=\"utf-8\">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to "+html.EscapeString(loc)+"</pre>\n</body>\n</html>\n"))
		return true
	}
	if p, err := url.PathUnescape(sub); err == nil {
		sub = p
	}
	name := strings.TrimPrefix(path.Clean("/"+sub), "/")
	if name == "" || name == "index.html" || name == "swagger-initializer.js" {
		page()
		return true
	}
	b, err := fs.ReadFile(swaggerFiles.FS, name)
	if err != nil {
		page()
		return true
	}
	ct := mime.TypeByExtension(path.Ext(name))
	if ct == "" {
		ct = "application/octet-stream"
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.Data(http.StatusOK, ct, b)
	return true
}
