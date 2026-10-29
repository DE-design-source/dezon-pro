-- Ngành ĐIỆN LẠNH (đề mục 3.2.7, dl-spec.js chép từ QS Pro ea787b6): bảng thông số 1-1 với products + view product_catalog thêm 38 cột.
-- Code: cột tiếng Việt của dl-spec.js trong db_san_pham (db-map.json), phần ghi tách sang product_hvac_specs ("parts").
-- 2 cột đổi tên so với QS Pro vì trùng cột ngành vệ sinh trong view: power_supply -> hvac_power_supply, control_type -> hvac_control_type.
-- Kiểm tra trước: chưa có bảng product_hvac_specs; view product_catalog đang có.
-- Quay lui: drop view product_catalog; tạo lại view theo 0006 (định nghĩa trong infra/db/schema.sql trước 0017); drop table product_hvac_specs;

do $$ begin
  if to_regclass('public.product_hvac_specs') is not null then raise exception '0017: bảng product_hvac_specs đã có'; end if;
  if to_regclass('public.product_catalog') is null then raise exception '0017: thiếu view product_catalog'; end if;
end $$;

create table product_hvac_specs (
  product_id bigint not null,
  unit_type text,
  cooling_capacity_kw text,
  capacity_hp text,
  capacity_btu text,
  operation_mode text,
  compressor_type text,
  refrigerant text,
  hvac_power_supply text,
  origin_country text,
  power_input_kw text,
  energy_efficiency text,
  energy_label text,
  airflow_m3h text,
  indoor_noise_db text,
  outdoor_noise_db text,
  cooling_area text,
  air_filtration text,
  hvac_control_type text,
  liquid_pipe text,
  gas_pipe text,
  max_pipe_length_m text,
  max_height_diff_m text,
  drain_pipe text,
  power_cable text,
  control_cable text,
  panel_model text,
  max_indoor_units text,
  refrigerant_charge text,
  indoor_unit_dimensions text,
  indoor_unit_weight_kg text,
  outdoor_unit_dimensions text,
  outdoor_unit_weight_kg text,
  panel_cutout_size text,
  installation_location text,
  outdoor_bracket text,
  min_clearance text,
  installation_note text,
  material_spec text,
  constraint pk_product_hvac_specs primary key (product_id),
  constraint fk_product_hvac_specs_product_id foreign key (product_id) references products (id) on delete cascade
);
comment on table product_hvac_specs is 'HVAC (Điện lạnh) specifications of a product: air conditioners, installation materials, ventilation (1-1 with products; row exists only when at least one value is set).';
comment on column product_hvac_specs.unit_type is 'HVAC spec (code: loai_may)';
comment on column product_hvac_specs.cooling_capacity_kw is 'HVAC spec (code: cs_lanh_kw)';
comment on column product_hvac_specs.capacity_hp is 'HVAC spec (code: cs_hp)';
comment on column product_hvac_specs.capacity_btu is 'HVAC spec (code: cs_btu)';
comment on column product_hvac_specs.operation_mode is 'HVAC spec (code: che_do_van_hanh)';
comment on column product_hvac_specs.compressor_type is 'HVAC spec (code: may_nen)';
comment on column product_hvac_specs.refrigerant is 'HVAC spec (code: moi_chat_lanh)';
comment on column product_hvac_specs.hvac_power_supply is 'HVAC spec (code: dien_nguon_dl)';
comment on column product_hvac_specs.origin_country is 'HVAC spec (code: xuat_xu)';
comment on column product_hvac_specs.power_input_kw is 'HVAC spec (code: cs_dien_kw)';
comment on column product_hvac_specs.energy_efficiency is 'HVAC spec (code: hieu_suat_nl)';
comment on column product_hvac_specs.energy_label is 'HVAC spec (code: nhan_nang_luong)';
comment on column product_hvac_specs.airflow_m3h is 'HVAC spec (code: luu_luong_gio)';
comment on column product_hvac_specs.indoor_noise_db is 'HVAC spec (code: do_on_dan_lanh)';
comment on column product_hvac_specs.outdoor_noise_db is 'HVAC spec (code: do_on_dan_nong)';
comment on column product_hvac_specs.cooling_area is 'HVAC spec (code: pham_vi_lam_lanh)';
comment on column product_hvac_specs.air_filtration is 'HVAC spec (code: loc_khi)';
comment on column product_hvac_specs.hvac_control_type is 'HVAC spec (code: dk_dieu_hoa)';
comment on column product_hvac_specs.liquid_pipe is 'HVAC spec (code: ong_long)';
comment on column product_hvac_specs.gas_pipe is 'HVAC spec (code: ong_hoi)';
comment on column product_hvac_specs.max_pipe_length_m is 'HVAC spec (code: ong_dai_max)';
comment on column product_hvac_specs.max_height_diff_m is 'HVAC spec (code: chenh_cao_max)';
comment on column product_hvac_specs.drain_pipe is 'HVAC spec (code: ong_thoat_nuoc)';
comment on column product_hvac_specs.power_cable is 'HVAC spec (code: day_nguon)';
comment on column product_hvac_specs.control_cable is 'HVAC spec (code: day_dieu_khien)';
comment on column product_hvac_specs.panel_model is 'HVAC spec (code: mat_na)';
comment on column product_hvac_specs.max_indoor_units is 'HVAC spec (code: so_dan_lanh_max)';
comment on column product_hvac_specs.refrigerant_charge is 'HVAC spec (code: gas_nap)';
comment on column product_hvac_specs.indoor_unit_dimensions is 'HVAC spec (code: kt_dan_lanh)';
comment on column product_hvac_specs.indoor_unit_weight_kg is 'HVAC spec (code: kl_dan_lanh)';
comment on column product_hvac_specs.outdoor_unit_dimensions is 'HVAC spec (code: kt_dan_nong)';
comment on column product_hvac_specs.outdoor_unit_weight_kg is 'HVAC spec (code: kl_dan_nong)';
comment on column product_hvac_specs.panel_cutout_size is 'HVAC spec (code: kt_mat_na)';
comment on column product_hvac_specs.installation_location is 'HVAC spec (code: vi_tri_lap_dat)';
comment on column product_hvac_specs.outdoor_bracket is 'HVAC spec (code: gia_do_dan_nong)';
comment on column product_hvac_specs.min_clearance is 'HVAC spec (code: kc_lap_min)';
comment on column product_hvac_specs.installation_note is 'HVAC spec (code: gc_lap_dat)';
comment on column product_hvac_specs.material_spec is 'HVAC spec (code: quy_cach_vt)';
comment on column product_hvac_specs.product_id is 'Product (products.id); row deleted with the product.';

-- View: thêm 38 cột s4 vào cuối, giữ nguyên thứ tự cột cũ (chép từ infra/db/schema.sql).
drop view product_catalog;
create view product_catalog as
 SELECT p.id,
    p.product_code,
    p.product_name,
    p.product_line,
    p.category,
    p.product_group,
    p.brand,
    p.supplier_name,
    p.power_w,
    p.color_temperature_k,
    p.beam_angle_deg,
    p.color,
    p.material,
    p.ip_rating,
    p.warranty_years,
    p.unit,
    p.retail_price,
    p.dealer_discount_pct,
    p.image_urls,
    p.datasheet_url,
    p.status,
    p.note,
    p.updated_at,
    p.company_id,
    p.is_approved,
    p.approved_by,
    p.approved_at,
    p.created_by,
    p.created_at,
    p.updated_by,
    p.variant_group,
    p.sector,
    p.size,
    p.caution,
    p.features,
    p.installation_type,
    p.surface_finish,
    p.spec_sheet_url,
    p.installation_guide_url,
    p.drawing_file_url,
    p.dealer_price,
    s0.luminous_flux_lm,
    s0.tilt_angle_deg,
    s0.height_mm,
    s0.diameter_mm,
    s0.cutout_mm,
    s0.cri,
    s0.luminous_efficacy_lm_w,
    s0.ugr,
    s0.sdcm,
    s0.coi,
    s0.lifespan,
    s0.led_chip_type,
    s0.protection_class,
    s0.has_separate_driver,
    s0.driver_name,
    s0.driver_code,
    s0.driver_brand,
    s0.driver_mounting_position,
    s0.control_compatibility,
    s0.max_output_current_ma,
    s0.led_chip_name,
    s0.driver_price,
    s1.flush_system,
    s1.flush_volume,
    s1.design,
    s1.rough_in_distance,
    s1.water_pressure,
    s1.lid_type,
    s1.faucet_type,
    s1.shower_type,
    s1.control_type,
    s1.massage_function,
    s1.bowl_count,
    s1.flow_rate,
    s1.valve_cartridge,
    s1.shower_head_size,
    s1.spray_modes,
    s1.faucet_hole_count,
    s1.overflow_hole,
    s1.capacity,
    s1.power_supply,
    s1.compatible_toilet,
    s1.thickness,
    s2.coverage,
    s2.drying_time,
    s2.coat_count,
    s2.physical_state,
    s2.odor,
    s2.odor_threshold,
    s2.ph_value,
    s2.melting_freezing_point,
    s2.boiling_point,
    s2.flash_point,
    s2.flammability,
    s2.explosive_limits,
    s2.vapor_pressure,
    s2.vapor_density,
    s2.water_solubility,
    s2.viscosity,
    s2.particle_characteristics,
    s2.relative_density,
    s3.component_type,
    s3.socket_count,
    s3.plug_type,
    s3.gang_count,
    s3.circuit_type,
    s3.operation_type,
    s3.indicator_light,
    s3.safety_shutter,
    s3.pack_quantity,
    s3.rated_current_a,
    s3.rated_voltage_v,
    s3.max_power_w,
    s3.max_load_power_w,
    s3.min_load_power_w,
    s3.load_type,
    s3.operation_cycles,
    s3.frequency_hz,
    s3.contact_material,
    s3.flame_resistance,
    s3.standards,
    s3.certifications,
    s3.usb_a_port_count,
    s3.usb_c_port_count,
    s3.usb_charging_power_w,
    s3.usb_output,
    s3.signal_connector_type,
    s3.smart_integration,
    s3.connectivity_protocol,
    s3.compatible_ecosystem,
    s3.neutral_wire,
    s3.sensor_type,
    s3.smart_features,
    s3.module_count,
    s3.face_width_mm,
    s3.face_height_mm,
    s3.face_depth_mm,
    s3.mounting_box_type,
    s3.min_box_depth_mm,
    s3.max_wire_cross_section,
    s4.unit_type,
    s4.cooling_capacity_kw,
    s4.capacity_hp,
    s4.capacity_btu,
    s4.operation_mode,
    s4.compressor_type,
    s4.refrigerant,
    s4.hvac_power_supply,
    s4.origin_country,
    s4.power_input_kw,
    s4.energy_efficiency,
    s4.energy_label,
    s4.airflow_m3h,
    s4.indoor_noise_db,
    s4.outdoor_noise_db,
    s4.cooling_area,
    s4.air_filtration,
    s4.hvac_control_type,
    s4.liquid_pipe,
    s4.gas_pipe,
    s4.max_pipe_length_m,
    s4.max_height_diff_m,
    s4.drain_pipe,
    s4.power_cable,
    s4.control_cable,
    s4.panel_model,
    s4.max_indoor_units,
    s4.refrigerant_charge,
    s4.indoor_unit_dimensions,
    s4.indoor_unit_weight_kg,
    s4.outdoor_unit_dimensions,
    s4.outdoor_unit_weight_kg,
    s4.panel_cutout_size,
    s4.installation_location,
    s4.outdoor_bracket,
    s4.min_clearance,
    s4.installation_note,
    s4.material_spec
   FROM (((((public.products p
     LEFT JOIN public.product_lighting_specs s0 ON ((s0.product_id = p.id)))
     LEFT JOIN public.product_sanitary_specs s1 ON ((s1.product_id = p.id)))
     LEFT JOIN public.product_paint_specs s2 ON ((s2.product_id = p.id)))
     LEFT JOIN public.product_switch_socket_specs s3 ON ((s3.product_id = p.id)))
     LEFT JOIN public.product_hvac_specs s4 ON ((s4.product_id = p.id)));;
comment on view product_catalog is 'products + the 5 per-sector spec tables, one row per product with every column. Read-only: writes go to the base tables (the data layer splits them). Recreate this view (drop + create) whenever a column is added to products or to any product_*_specs table.';

-- Xác minh sau
do $$ begin
  if to_regclass('public.product_hvac_specs') is null then raise exception '0017: thiếu bảng product_hvac_specs'; end if;
  if (select count(*) from information_schema.columns where table_name = 'product_catalog' and table_schema = 'public') <> 179
    then raise exception '0017: view product_catalog không đủ 179 cột'; end if;
end $$;
