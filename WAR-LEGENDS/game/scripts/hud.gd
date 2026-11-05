extends CanvasLayer
class_name WarLegendsHUD

const BattleRules = preload("res://scripts/battle_rules.gd")
const SaveManager = preload("res://scripts/save_manager.gd")

var game: Node
var root: Control
var font: Font
var theme_data: Theme
var player_health_label: Label
var enemy_health_label: Label
var energy_bar: ProgressBar
var energy_label: Label
var clock_label: Label
var status_label: Label
var subtitle_label: Label
var card_buttons: Dictionary = {}
var overlay: ColorRect
var overlay_panel: PanelContainer
var subtitle_clock: float = 0.0

func setup(game_ref: Node) -> void:
	game = game_ref
	font = load("res://fonts/NotoKufiArabic-Regular.ttf")
	theme_data = Theme.new()
	theme_data.default_font = font
	theme_data.default_font_size = 16
	root = Control.new()
	root.name = "ArabicHUD"
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.layout_direction = Control.LAYOUT_DIRECTION_RTL
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.theme = theme_data
	add_child(root)
	_build_top_bar()
	_build_cards()
	_build_status_and_subtitles()
	refresh()

func _process(delta: float) -> void:
	if subtitle_clock > 0.0:
		subtitle_clock -= delta
		if subtitle_clock <= 0.0 and is_instance_valid(subtitle_label):
			subtitle_label.visible = false

func _build_top_bar() -> void:
	var panel := _panel(root, Rect2(0.016, 0.018, 0.968, 0.132), Color("#101c22e8"), Color("#48616a"))
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 22)
	margin.add_theme_constant_override("margin_right", 22)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_bottom", 8)
	panel.add_child(margin)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	margin.add_child(row)
	var title := _label("حصن الفجر  •  المهمة %02d" % int(game.save_data.get("mission", 1)), 19, Color("#e8d5a2"), HORIZONTAL_ALIGNMENT_RIGHT)
	title.custom_minimum_size.x = 286
	row.add_child(title)
	var separator := VSeparator.new()
	row.add_child(separator)
	player_health_label = _label("قاعدتنا 100٪", 15, Color("#78dfbc"), HORIZONTAL_ALIGNMENT_CENTER)
	player_health_label.custom_minimum_size.x = 150
	row.add_child(player_health_label)
	enemy_health_label = _label("مقرّ العدو 100٪", 15, Color("#f09577"), HORIZONTAL_ALIGNMENT_CENTER)
	enemy_health_label.custom_minimum_size.x = 180
	row.add_child(enemy_health_label)
	var energy_box := VBoxContainer.new()
	energy_box.custom_minimum_size.x = 158
	energy_box.add_theme_constant_override("separation", 2)
	energy_label = _label("الطاقة ٥ / ١٠", 13, Color("#a7dff0"), HORIZONTAL_ALIGNMENT_CENTER)
	energy_box.add_child(energy_label)
	energy_bar = ProgressBar.new()
	energy_bar.min_value = 0.0
	energy_bar.max_value = BattleRules.MAX_ENERGY
	energy_bar.show_percentage = false
	energy_bar.custom_minimum_size = Vector2(150, 13)
	energy_bar.add_theme_stylebox_override("background", _style(Color("#1d2c32"), Color("#31434a"), 7, 1))
	energy_bar.add_theme_stylebox_override("fill", _style(Color("#63d7cd"), Color("#63d7cd"), 7, 0))
	energy_box.add_child(energy_bar)
	row.add_child(energy_box)
	clock_label = _label("٠٠:٠٠", 15, Color("#d5e0de"), HORIZONTAL_ALIGNMENT_CENTER)
	clock_label.custom_minimum_size.x = 82
	row.add_child(clock_label)
	var pause_button := _button("إيقاف", 14, Vector2(92, 46), func(): game.toggle_pause())
	row.add_child(pause_button)
	var settings_button := _button("الرسوم", 14, Vector2(92, 46), func(): game.open_settings())
	row.add_child(settings_button)

func _build_cards() -> void:
	var panel := _panel(root, Rect2(0.018, 0.815, 0.964, 0.17), Color("#101c22ed"), Color("#48616a"))
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_top", 7)
	margin.add_theme_constant_override("margin_bottom", 7)
	panel.add_child(margin)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 9)
	margin.add_child(row)
	for unit_id in BattleRules.UNIT_DATA.keys():
		var data: Dictionary = BattleRules.UNIT_DATA[unit_id]
		var card := Button.new()
		card.name = "Card_" + unit_id
		card.custom_minimum_size = Vector2(0, 92)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.size_flags_vertical = Control.SIZE_EXPAND_FILL
		card.text = "%s\n%s\n%d طاقة" % [data["name"], data["role"], data["cost"]]
		card.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		card.alignment = HORIZONTAL_ALIGNMENT_CENTER
		card.layout_direction = Control.LAYOUT_DIRECTION_RTL
		card.add_theme_font_size_override("font_size", 14)
		card.add_theme_color_override("font_color", Color("#e4efea"))
		card.add_theme_color_override("font_disabled_color", Color("#76827e"))
		card.add_theme_stylebox_override("normal", _style(Color("#203238"), Color("#52666a"), 9, 1))
		card.add_theme_stylebox_override("hover", _style(Color("#2a454a"), Color("#8ac5b5"), 9, 2))
		card.add_theme_stylebox_override("pressed", _style(Color("#275b56"), Color("#9de2c9"), 9, 2))
		card.add_theme_stylebox_override("disabled", _style(Color("#182327"), Color("#374348"), 9, 1))
		card.pressed.connect(func(): game.select_unit(unit_id))
		row.add_child(card)
		card_buttons[unit_id] = card

func _build_status_and_subtitles() -> void:
	status_label = _label("اختر بطاقة ثم المس أحد المسارات في منطقتك لنشر الوحدة", 14, Color("#e0d1a5"), HORIZONTAL_ALIGNMENT_CENTER)
	status_label.anchor_left = 0.19
	status_label.anchor_right = 0.81
	status_label.anchor_top = 0.755
	status_label.anchor_bottom = 0.805
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(status_label)
	subtitle_label = _label("", 15, Color("#f6efda"), HORIZONTAL_ALIGNMENT_CENTER)
	subtitle_label.anchor_left = 0.20
	subtitle_label.anchor_right = 0.80
	subtitle_label.anchor_top = 0.685
	subtitle_label.anchor_bottom = 0.75
	subtitle_label.add_theme_color_override("font_shadow_color", Color("#071014"))
	subtitle_label.add_theme_constant_override("shadow_offset_x", 2)
	subtitle_label.add_theme_constant_override("shadow_offset_y", 2)
	subtitle_label.visible = false
	subtitle_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(subtitle_label)

func refresh() -> void:
	if game == null or not is_instance_valid(root):
		return
	var player_ratio: float = game.player_base.get_health_ratio() if is_instance_valid(game.player_base) else 0.0
	var enemy_ratio: float = game.enemy_base.get_health_ratio() if is_instance_valid(game.enemy_base) else 0.0
	player_health_label.text = "قاعدتنا %d٪" % roundi(player_ratio * 100.0)
	enemy_health_label.text = "مقرّ العدو %d٪" % roundi(enemy_ratio * 100.0)
	energy_bar.value = game.energy
	energy_label.text = "الطاقة %s / ١٠" % _arabic_digits(str(roundi(game.energy)))
	clock_label.text = _format_clock(game.elapsed_seconds)
	for unit_id in card_buttons.keys():
		var button: Button = card_buttons[unit_id]
		var cost := int(BattleRules.UNIT_DATA[unit_id]["cost"])
		button.disabled = game.energy < cost or game.state == game.State.PAUSED or game.state == game.State.RESULT
		var selected: bool = game.selected_unit_id == unit_id
		var border_color := Color("#9de2c9") if selected else Color("#52666a")
		var border_width := 3 if selected else 1
		button.add_theme_stylebox_override("normal", _style(Color("#27554f") if selected else Color("#203238"), border_color, 9, border_width))
		button.add_theme_stylebox_override("hover", _style(Color("#2a454a"), Color("#8ac5b5"), 9, 2))
		button.add_theme_stylebox_override("pressed", _style(Color("#275b56"), Color("#9de2c9"), 9, 2))

func show_subtitle(text: String, duration: float = 3.4) -> void:
	if subtitle_label == null:
		return
	subtitle_label.text = text
	subtitle_label.visible = true
	subtitle_clock = duration

func show_menu() -> void:
	_open_overlay("menu")

func show_pause() -> void:
	_open_overlay("pause")

func show_result(victory: bool, mission: int, wins: int, losses: int) -> void:
	_open_overlay("result", {"victory": victory, "mission": mission, "wins": wins, "losses": losses})

func show_settings() -> void:
	_open_overlay("settings")

func hide_overlay() -> void:
	if is_instance_valid(overlay):
		overlay.queue_free()
	overlay = null
	overlay_panel = null

func _open_overlay(kind: String, data: Dictionary = {}) -> void:
	hide_overlay()
	overlay = ColorRect.new()
	overlay.name = "ModalOverlay"
	overlay.color = Color(0.025, 0.055, 0.065, 0.82)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(overlay)
	overlay_panel = PanelContainer.new()
	overlay_panel.anchor_left = 0.22
	overlay_panel.anchor_right = 0.78
	overlay_panel.anchor_top = 0.16 if kind != "settings" else 0.13
	overlay_panel.anchor_bottom = 0.84 if kind != "settings" else 0.87
	overlay_panel.add_theme_stylebox_override("panel", _style(Color("#142229f7"), Color("#8b8060"), 18, 2))
	overlay.add_child(overlay_panel)
	var margin := MarginContainer.new()
	for edge in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + edge, 30)
	for edge in ["top", "bottom"]:
		margin.add_theme_constant_override("margin_" + edge, 24)
	overlay_panel.add_child(margin)
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 12)
	margin.add_child(column)
	match kind:
		"menu":
			_add_menu_content(column)
		"pause":
			_add_pause_content(column)
		"result":
			_add_result_content(column, data)
		"settings":
			_add_settings_content(column)

func _add_menu_content(column: VBoxContainer) -> void:
	column.add_child(_label("WAR  LEGENDS", 30, Color("#e5d2a0"), HORIZONTAL_ALIGNMENT_CENTER))
	column.add_child(_label("حِصن الفجر", 25, Color("#f1ead7"), HORIZONTAL_ALIGNMENT_CENTER))
	column.add_child(_label("الفصل الأول  •  ممرّ الرماد\nأمّن الطرق، احمِ القاعدة، وأسقط مقرّ الخصم.", 16, Color("#b7c6c1"), HORIZONTAL_ALIGNMENT_CENTER))
	var progress_text := "انتصارات %d  •  هزائم %d  •  الوحدات المفتوحة %d" % [int(game.save_data.get("wins", 0)), int(game.save_data.get("losses", 0)), game.save_data.get("unlocked_units", BattleRules.UNIT_DATA.keys()).size()]
	column.add_child(_label(progress_text, 14, Color("#90b5a8"), HORIZONTAL_ALIGNMENT_CENTER))
	var start_button := _button("ابدأ المعركة", 19, Vector2(250, 56), func(): game.start_battle())
	start_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	start_button.add_theme_stylebox_override("normal", _style(Color("#356e60"), Color("#9de2c9"), 12, 2))
	start_button.add_theme_stylebox_override("hover", _style(Color("#438371"), Color("#c4f0d7"), 12, 2))
	column.add_child(start_button)
	column.add_child(_label("تعمل بلا اتصال بالإنترنت  •  لا حساب ولا مباريات شبكية", 12, Color("#82928e"), HORIZONTAL_ALIGNMENT_CENTER))

func _add_pause_content(column: VBoxContainer) -> void:
	column.add_child(_label("إيقاف مؤقت", 26, Color("#e7d7ae"), HORIZONTAL_ALIGNMENT_CENTER))
	column.add_child(_label("المعركة متوقفة. يمكنك المتابعة أو البدء من جديد.", 15, Color("#c3d0ca"), HORIZONTAL_ALIGNMENT_CENTER))
	var resume := _button("متابعة القتال", 17, Vector2(250, 50), func(): game.resume_battle())
	resume.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(resume)
	var restart := _button("إعادة المعركة", 15, Vector2(230, 46), func(): game.restart_battle())
	restart.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(restart)
	var settings := _button("إعدادات الرسوم", 14, Vector2(230, 42), func(): show_settings())
	settings.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(settings)

func _add_result_content(column: VBoxContainer, data: Dictionary) -> void:
	var won := bool(data.get("victory", false))
	column.add_child(_label("النصر لك!" if won else "خسرنا هذه الجولة", 29, Color("#97e4be") if won else Color("#f19a7b"), HORIZONTAL_ALIGNMENT_CENTER))
	column.add_child(_label("%s\nالمهمة القادمة: %02d" % ["دُمّر مقرّ الخصم وحُميت القاعدة." if won else "سقطت القاعدة. بدّل توزيع قواتك وحاول مجددًا.", int(data.get("mission", 1))], 16, Color("#d3ded4"), HORIZONTAL_ALIGNMENT_CENTER))
	column.add_child(_label("سجلّ الحملة  •  %d انتصار / %d هزيمة" % [int(data.get("wins", 0)), int(data.get("losses", 0))], 14, Color("#9bb9ab"), HORIZONTAL_ALIGNMENT_CENTER))
	var replay := _button("إعادة اللعب", 18, Vector2(240, 52), func(): game.restart_battle())
	replay.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(replay)
	var menu_button := _button("العودة إلى القائمة", 14, Vector2(220, 42), func(): game.return_to_menu())
	menu_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(menu_button)

func _add_settings_content(column: VBoxContainer) -> void:
	column.add_child(_label("إعدادات العرض", 26, Color("#e7d7ae"), HORIZONTAL_ALIGNMENT_CENTER))
	column.add_child(_label("اختر جودة تناسب جهازك؛ يمكن تغييرها في أي وقت.", 14, Color("#b9c9c2"), HORIZONTAL_ALIGNMENT_CENTER))
	var presets := HBoxContainer.new()
	presets.alignment = BoxContainer.ALIGNMENT_CENTER
	presets.add_theme_constant_override("separation", 8)
	column.add_child(presets)
	for preset in ["low", "medium", "high", "ultra"]:
		var translated: String = {"low": "منخفض", "medium": "متوسط", "high": "عالٍ", "ultra": "فائق"}[preset]
		var button := _button(translated, 14, Vector2(112, 46), func(): game.set_graphics_preset(preset))
		presets.add_child(button)
	var fps_row := HBoxContainer.new()
	fps_row.alignment = BoxContainer.ALIGNMENT_CENTER
	fps_row.add_theme_constant_override("separation", 8)
	column.add_child(fps_row)
	fps_row.add_child(_label("حدّ الإطارات:", 14, Color("#c5d1cb"), HORIZONTAL_ALIGNMENT_CENTER))
	for cap in [30, 45, 60, 90]:
		var button := _button("%d FPS" % cap, 13, Vector2(90, 40), func(): game.set_fps_cap(cap))
		fps_row.add_child(button)
	var sound_button := _button("الصوت: تشغيل" if game.sound_enabled else "الصوت: إيقاف", 14, Vector2(180, 42), func(): game.toggle_sound())
	sound_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(sound_button)
	var back := _button("عودة", 15, Vector2(160, 43), func(): _return_from_settings())
	back.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(back)
	column.add_child(_label("تتدرج الظلال ودقة العرض حسب الإعداد.", 12, Color("#86958e"), HORIZONTAL_ALIGNMENT_CENTER))

func _return_from_settings() -> void:
	if game.state == game.State.PAUSED:
		show_pause()
	elif game.state == game.State.MENU:
		show_menu()
	else:
		hide_overlay()

func _panel(parent: Control, rect: Rect2, color: Color, border: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.anchor_left = rect.position.x
	panel.anchor_top = rect.position.y
	panel.anchor_right = rect.position.x + rect.size.x
	panel.anchor_bottom = rect.position.y + rect.size.y
	panel.add_theme_stylebox_override("panel", _style(color, border, 12, 1))
	parent.add_child(panel)
	return panel

func _label(text: String, size: int, color: Color, alignment: HorizontalAlignment) -> Label:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = alignment
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.layout_direction = Control.LAYOUT_DIRECTION_RTL
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return label

func _button(text: String, size: int, minimum: Vector2, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = minimum
	button.layout_direction = Control.LAYOUT_DIRECTION_RTL
	button.add_theme_font_size_override("font_size", size)
	button.add_theme_color_override("font_color", Color("#e1ebe5"))
	button.add_theme_stylebox_override("normal", _style(Color("#273a40"), Color("#576c70"), 10, 1))
	button.add_theme_stylebox_override("hover", _style(Color("#35514f"), Color("#9de2c9"), 10, 2))
	button.add_theme_stylebox_override("pressed", _style(Color("#315d54"), Color("#a9e8cf"), 10, 2))
	button.pressed.connect(callback)
	return button

func _style(color: Color, border: Color, radius: int, border_size: int) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.set_border_width_all(border_size)
	style.set_corner_radius_all(radius)
	style.content_margin_left = 8.0
	style.content_margin_right = 8.0
	style.content_margin_top = 5.0
	style.content_margin_bottom = 5.0
	return style

func _format_clock(seconds: float) -> String:
	var whole := maxi(0, int(seconds))
	var minutes := whole / 60
	var remainder := whole % 60
	return "%s:%s" % [_arabic_digits("%02d" % minutes), _arabic_digits("%02d" % remainder)]

func _arabic_digits(value: String) -> String:
	var output := value
	var latin := ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
	var arabic := ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"]
	for i in range(latin.size()):
		output = output.replace(latin[i], arabic[i])
	return output
