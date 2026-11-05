extends Node3D
class_name WarLegendsGame

const State = {"MENU": 0, "ACTIVE": 1, "PAUSED": 2, "RESULT": 3}
const BattleRules = preload("res://scripts/battle_rules.gd")
const UnitActor = preload("res://scripts/unit_actor.gd")
const BaseStructure = preload("res://scripts/base_structure.gd")
const HUDScript = preload("res://scripts/hud.gd")
const SaveManager = preload("res://scripts/save_manager.gd")

var state: int = State.MENU
var save_data: Dictionary = {}
var hud: WarLegendsHUD
var camera: Camera3D
var player_base: BaseStructure
var enemy_base: BaseStructure
var structures: Array = []
var units: Array = []
var player_units: Array = []
var enemy_units: Array = []
var energy: float = 5.0
var enemy_energy: float = 5.0
var elapsed_seconds: float = 0.0
var enemy_ai_clock: float = 2.8
var selected_unit_id: String = ""
var sound_enabled: bool = true
var graphics_preset: String = "medium"
var fps_cap: int = 60
var voice_streams: Dictionary = {}
var last_reinforcement_voice: float = -100.0
var world_root: Node3D
var directional_light: DirectionalLight3D

func _ready() -> void:
	randomize()
	save_data = SaveManager.load_save()
	sound_enabled = bool(save_data.get("sound_enabled", true))
	fps_cap = int(save_data.get("fps_cap", 60))
	graphics_preset = str(save_data.get("graphics_preset", "auto"))
	if graphics_preset == "auto":
		graphics_preset = _detect_graphics_preset()
	_apply_graphics_preset()
	_build_world()
	_create_structures()
	hud = HUDScript.new()
	add_child(hud)
	hud.setup(self)
	hud.show_menu()

func _process(delta: float) -> void:
	if state != State.ACTIVE:
		return
	elapsed_seconds += delta
	energy = minf(BattleRules.MAX_ENERGY, energy + BattleRules.ENERGY_REGEN * delta)
	enemy_energy = minf(BattleRules.MAX_ENERGY, enemy_energy + 0.64 * delta)
	enemy_ai_clock -= delta
	if enemy_ai_clock <= 0.0:
		_enemy_turn()
		enemy_ai_clock = randf_range(2.4, 3.4)
	hud.refresh()

func is_battle_active() -> bool:
	return state == State.ACTIVE

func start_battle() -> void:
	if state == State.RESULT:
		restart_battle()
		return
	state = State.ACTIVE
	selected_unit_id = ""
	hud.hide_overlay()
	show_callout("commander_opening", "استعدوا! رُصد تحرّك معادٍ قرب البوابة الشرقية.")
	hud.show_subtitle("اختر بطاقةً، ثم المس أحد المسارات في منطقتك لنشر الوحدة.", 5.5)
	hud.refresh()

func pause_battle() -> void:
	if state != State.ACTIVE:
		return
	state = State.PAUSED
	hud.show_pause()
	hud.refresh()

func resume_battle() -> void:
	if state != State.PAUSED:
		return
	state = State.ACTIVE
	hud.hide_overlay()
	hud.refresh()

func toggle_pause() -> void:
	if state == State.ACTIVE:
		pause_battle()
	elif state == State.PAUSED:
		resume_battle()

func open_settings() -> void:
	if state == State.ACTIVE:
		state = State.PAUSED
	if is_instance_valid(hud):
		hud.show_settings()
		hud.refresh()

func return_to_menu() -> void:
	state = State.MENU
	selected_unit_id = ""
	hud.show_menu()
	hud.refresh()

func restart_battle() -> void:
	state = State.PAUSED
	for actor in units.duplicate():
		if is_instance_valid(actor):
			actor.queue_free()
	units.clear()
	player_units.clear()
	enemy_units.clear()
	for structure in structures.duplicate():
		if is_instance_valid(structure):
			structure.queue_free()
	structures.clear()
	player_base = null
	enemy_base = null
	await get_tree().process_frame
	_create_structures()
	energy = 5.0
	enemy_energy = 5.0
	elapsed_seconds = 0.0
	enemy_ai_clock = 2.8
	selected_unit_id = ""
	state = State.ACTIVE
	hud.hide_overlay()
	show_callout("commander_opening", "استعدوا! أُعيد نشر القوات. احموا القاعدة.")
	hud.show_subtitle("المعركة الجديدة بدأت. انشر قواتك في المسارات الثلاثة.", 4.0)
	hud.refresh()

func select_unit(unit_id: String) -> void:
	if state != State.ACTIVE:
		return
	if not BattleRules.UNIT_DATA.has(unit_id):
		return
	if not BattleRules.can_deploy(energy, unit_id):
		hud.show_subtitle("طاقة غير كافية لهذه الوحدة.", 2.0)
		return
	selected_unit_id = unit_id
	hud.show_subtitle("تم اختيار %s — المس منطقتك لنشرها." % BattleRules.UNIT_DATA[unit_id]["name"], 2.2)
	hud.refresh()

func _unhandled_input(event: InputEvent) -> void:
	if state != State.ACTIVE or selected_unit_id.is_empty():
		return
	var screen_position := Vector2(-1.0, -1.0)
	if event is InputEventScreenTouch and event.pressed:
		screen_position = event.position
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		screen_position = event.position
	if screen_position.x >= 0.0:
		on_battlefield_tap(screen_position)

func on_battlefield_tap(screen_position: Vector2) -> void:
	if camera == null or state != State.ACTIVE or selected_unit_id.is_empty():
		return
	var ray_origin := camera.project_ray_origin(screen_position)
	var ray_direction := camera.project_ray_normal(screen_position)
	if absf(ray_direction.y) < 0.0001:
		return
	var distance := -ray_origin.y / ray_direction.y
	if distance < 0.0:
		return
	var point := ray_origin + ray_direction * distance
	if point.z < BattleRules.PLAYER_DEPLOY_MIN_Z:
		hud.show_subtitle("لا يمكن النشر خلف خطوط العدو. اختر المساحة المضيئة.", 2.2)
		return
	var lane := BattleRules.lane_from_x(point.x)
	var spawn_z := clampf(point.z, 3.0, 7.6)
	if not deploy_unit(selected_unit_id, lane, spawn_z, 0):
		hud.show_subtitle("تحتاج إلى طاقة أكثر لنشر هذه الوحدة.", 2.0)
	return
	selected_unit_id = selected_unit_id
	if elapsed_seconds - last_reinforcement_voice > 16.0:
		show_callout("reinforcements", "وصلت التعزيزات. ننتظر أوامرك.")
		last_reinforcement_voice = elapsed_seconds
	hud.show_subtitle("%s — المسار %s" % [BattleRules.UNIT_DATA[units.back().unit_id]["name"], ["الأيسر", "الأوسط", "الأيمن"][lane]], 1.7)
	hud.refresh()

func deploy_unit(unit_id: String, lane: int, spawn_z: float, team: int = 0) -> bool:
	if not BattleRules.lane_is_valid(lane) or not BattleRules.UNIT_DATA.has(unit_id):
		return false
	if team == 0 and not BattleRules.can_deploy(energy, unit_id):
		return false
	var cost := float(BattleRules.UNIT_DATA[unit_id]["cost"])
	if team == 1 and enemy_energy < cost:
		return false
	var actor: UnitActor = UnitActor.new()
	actor.name = ("Player_" if team == 0 else "Enemy_") + unit_id + "_" + str(Time.get_ticks_usec())
	add_child(actor)
	actor.setup(self, unit_id, team, lane, spawn_z)
	units.append(actor)
	if team == 0:
		energy = maxf(0.0, energy - cost)
		player_units.append(actor)
	else:
		enemy_energy = maxf(0.0, enemy_energy - cost)
		enemy_units.append(actor)
	return true

func _enemy_turn() -> void:
	var affordable: Array[String] = []
	for unit_id in BattleRules.UNIT_DATA.keys():
		if enemy_energy >= float(BattleRules.UNIT_DATA[unit_id]["cost"]):
			affordable.append(unit_id)
	if affordable.is_empty():
		return
	var lane_counts := [0, 0, 0]
	for unit in enemy_units:
		if is_instance_valid(unit) and unit.alive:
			lane_counts[unit.lane] += 1
	var fewest := mini(lane_counts[0], mini(lane_counts[1], lane_counts[2]))
	var candidates: Array[int] = []
	for lane_index in range(3):
		if lane_counts[lane_index] == fewest:
			candidates.append(lane_index)
	var lane := candidates[randi_range(0, candidates.size() - 1)]
	var chosen := affordable[randi_range(0, affordable.size() - 1)]
	if enemy_energy >= 5.0 and randf() < 0.28:
		chosen = "vehicle"
	elif enemy_energy >= 4.0 and randf() < 0.28:
		chosen = "commander"
	elif player_units.size() > 2 and randf() < 0.35:
		chosen = "sniper"
	if enemy_energy < float(BattleRules.UNIT_DATA[chosen]["cost"]):
		chosen = affordable[0]
	deploy_unit(chosen, lane, -6.0, 1)

func get_unit_target(actor: UnitActor) -> Node3D:
	if not is_instance_valid(actor):
		return null
	var enemy_team := 1 - actor.team
	var best_unit: Node3D = null
	var best_distance := INF
	var roster: Array = player_units if enemy_team == 0 else enemy_units
	for other in roster:
		if not is_instance_valid(other) or not other.alive or other.lane != actor.lane:
			continue
		var distance := actor.global_position.distance_to(other.global_position)
		if distance < best_distance:
			best_distance = distance
			best_unit = other
	if best_unit != null:
		return best_unit
	var best_structure: Node3D = null
	var best_z_distance := INF
	for structure in structures:
		if not is_instance_valid(structure) or not structure.alive or structure.team == actor.team:
			continue
		if structure.kind == "turret" and structure.lane != actor.lane:
			continue
		var z_distance := absf(actor.global_position.z - structure.global_position.z)
		if z_distance < best_z_distance:
			best_z_distance = z_distance
			best_structure = structure
	if best_structure == null:
		return enemy_base if enemy_team == 1 else player_base
	return best_structure

func get_nearest_enemy_unit(team: int, origin: Vector3, radius: float, lane_filter: int = -1) -> UnitActor:
	var roster: Array = enemy_units if team == 0 else player_units
	var best: UnitActor
	var best_distance := radius
	for unit in roster:
		if not is_instance_valid(unit) or not unit.alive:
			continue
		if lane_filter >= 0 and unit.lane != lane_filter:
			continue
		var distance := origin.distance_to(unit.global_position)
		if distance <= best_distance:
			best_distance = distance
			best = unit
	return best

func get_commander_bonus(team: int, origin: Vector3) -> float:
	var roster: Array = player_units if team == 0 else enemy_units
	for unit in roster:
		if is_instance_valid(unit) and unit.alive and unit.unit_id == "commander" and origin.distance_to(unit.global_position) <= 3.7:
			return 1.18
	return 1.0

func get_damaged_friendly_structure(team: int, origin: Vector3, radius: float) -> BaseStructure:
	var best: BaseStructure
	var lowest_ratio := 0.94
	for structure in structures:
		if not is_instance_valid(structure) or not structure.alive or structure.team != team:
			continue
		if origin.distance_to(structure.global_position) > radius:
			continue
		var ratio: float = structure.get_health_ratio()
		if ratio < lowest_ratio:
			lowest_ratio = ratio
			best = structure
	return best

func spawn_projectile(start: Vector3, finish: Vector3, color: Color, duration: float = 0.2) -> void:
	var shot := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.105
	sphere.height = 0.21
	shot.mesh = sphere
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.emission_enabled = true
	material.emission = color
	material.emission_energy_multiplier = 1.6
	shot.material_override = material
	add_child(shot)
	shot.global_position = start
	var tween := create_tween()
	tween.set_trans(Tween.TRANS_CUBIC)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_property(shot, "global_position", finish, duration)
	tween.tween_callback(shot.queue_free)

func on_unit_died(actor: UnitActor) -> void:
	units.erase(actor)
	player_units.erase(actor)
	enemy_units.erase(actor)

func on_structure_destroyed(structure: BaseStructure) -> void:
	structures.erase(structure)
	if is_instance_valid(hud):
		hud.show_subtitle("سقط برج دفاعي. تقدّم بحذر.", 2.3)

func on_base_destroyed(team: int, attacker_team: int) -> void:
	if state != State.ACTIVE:
		return
	finish_battle(attacker_team == 0 if attacker_team >= 0 else team == 1)

func finish_battle(victory: bool) -> void:
	if state == State.RESULT:
		return
	state = State.RESULT
	selected_unit_id = ""
	if victory:
		save_data = SaveManager.record_victory(elapsed_seconds)
		show_callout("victory", "المقرّ المعادي ينهار! النصر لنا!")
	else:
		save_data = SaveManager.record_defeat(elapsed_seconds)
		show_callout("defeat", "تراجعوا إلى خط الدفاع! سنعود أقوى.")
	hud.show_result(victory, int(save_data.get("mission", 1)), int(save_data.get("wins", 0)), int(save_data.get("losses", 0)))
	hud.refresh()

func show_callout(event_id: String, text_fallback: String) -> void:
	if is_instance_valid(hud):
		hud.show_subtitle(text_fallback, 3.7)
	if not sound_enabled:
		return
	var voice_path := "res://audio/%s.wav" % event_id
	if not ResourceLoader.exists(voice_path):
		return
	var stream: AudioStream = load(voice_path)
	if stream == null:
		return
	var player := AudioStreamPlayer.new()
	player.stream = stream
	player.volume_db = -8.0
	add_child(player)
	player.finished.connect(player.queue_free)
	player.play()

func set_graphics_preset(preset: String) -> void:
	if preset not in ["low", "medium", "high", "ultra"]:
		return
	graphics_preset = preset
	SaveManager.set_option("graphics_preset", preset)
	_apply_graphics_preset()
	if is_instance_valid(hud):
		hud.show_subtitle("تم تطبيق إعداد الرسوم: %s." % {"low": "منخفض", "medium": "متوسط", "high": "عالٍ", "ultra": "فائق"}[preset], 2.0)
		hud.show_settings()

func set_fps_cap(cap: int) -> void:
	fps_cap = clampi(cap, 30, 90)
	Engine.max_fps = fps_cap
	SaveManager.set_option("fps_cap", fps_cap)
	if is_instance_valid(hud):
		hud.show_subtitle("حدّ الإطارات الآن %d في الثانية." % fps_cap, 2.0)
		hud.show_settings()

func toggle_sound() -> void:
	sound_enabled = not sound_enabled
	SaveManager.set_option("sound_enabled", sound_enabled)
	hud.show_settings()

func _apply_graphics_preset() -> void:
	Engine.max_fps = fps_cap
	var scale_3d := 0.74
	match graphics_preset:
		"low": scale_3d = 0.70
		"medium": scale_3d = 0.82
		"high": scale_3d = 0.92
		"ultra": scale_3d = 1.0
	if get_viewport() != null:
		get_viewport().scaling_3d_scale = scale_3d
	if is_instance_valid(directional_light):
		directional_light.shadow_enabled = graphics_preset in ["high", "ultra"]

func _detect_graphics_preset() -> String:
	if OS.get_name() != "Android":
		return "high"
	var cores := OS.get_processor_count()
	var screen := DisplayServer.screen_get_size()
	var pixels := screen.x * screen.y
	if cores >= 10 and pixels <= 5200000:
		return "ultra"
	if cores >= 8:
		return "high"
	if cores >= 6:
		return "medium"
	return "low"

func _build_world() -> void:
	world_root = Node3D.new()
	world_root.name = "RuinedFrontier"
	add_child(world_root)
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#0b141a")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#81949b")
	environment.ambient_light_energy = 0.72
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	world_root.add_child(world_environment)
	directional_light = DirectionalLight3D.new()
	directional_light.rotation_degrees = Vector3(-48.0, -23.0, 0.0)
	directional_light.light_energy = 1.45
	directional_light.shadow_enabled = graphics_preset in ["high", "ultra"]
	world_root.add_child(directional_light)
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(21.5, 26.0)
	ground.mesh = plane
	var terrain_material := _material(Color("#ffffff"), 0.0, 0.96)
	terrain_material.albedo_texture = _make_terrain_texture()
	terrain_material.uv1_scale = Vector3(8.0, 8.0, 1.0)
	ground.material_override = terrain_material
	ground.position.y = -0.10
	world_root.add_child(ground)
	for lane_index in range(3):
		var x: float = BattleRules.lane_x(lane_index)
		_add_box(world_root, Vector3(2.58, 0.045, 21.8), Vector3(x, -0.045, 0.0), Color("#27383a"), 0.02)
		_add_box(world_root, Vector3(0.045, 0.025, 21.2), Vector3(x - 1.31, 0.0, 0.0), Color("#668474"), 0.0, true)
		_add_box(world_root, Vector3(0.045, 0.025, 21.2), Vector3(x + 1.31, 0.0, 0.0), Color("#668474"), 0.0, true)
	for z in [-1.25, 1.25]:
		_add_box(world_root, Vector3(20.5, 0.025, 0.07), Vector3(0.0, -0.01, z), Color("#718070"), 0.0, true)
	_add_box(world_root, Vector3(0.06, 0.028, 22.5), Vector3(-10.25, 0.0, 0.0), Color("#8a7555"), 0.0, true)
	_add_box(world_root, Vector3(0.06, 0.028, 22.5), Vector3(10.25, 0.0, 0.0), Color("#8a7555"), 0.0, true)
	_add_terrain_details()
	camera = Camera3D.new()
	camera.name = "TacticalCamera"
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 21.0
	camera.position = Vector3(0.0, 20.5, 21.0)
	world_root.add_child(camera)
	camera.look_at(Vector3(0.0, 0.0, 0.0), Vector3.UP)
	camera.current = true
	camera.far = 100.0

func _add_terrain_details() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7135206
	for index in range(34):
		var side := -1.0 if index % 2 == 0 else 1.0
		var x := side * rng.randf_range(7.0, 9.5)
		var z := rng.randf_range(-10.0, 10.0)
		var size := rng.randf_range(0.35, 1.2)
		var color := Color("#49514a") if index % 3 == 0 else Color("#544b40")
		var crate := _add_box(world_root, Vector3(size, size * rng.randf_range(0.55, 1.35), size), Vector3(x, size * 0.28, z), color, 0.08)
		crate.rotation_degrees.y = rng.randf_range(-22.0, 22.0)
	for lane_index in range(3):
		var x: float = BattleRules.lane_x(lane_index)
		for z in [-5.0, 0.0, 5.0]:
			var mark := _add_cylinder(world_root, 0.10, 0.035, Vector3(x, 0.025, z), Color("#728b77"), true)
			mark.rotation_degrees.x = 0.0
	for z in [-2.4, 2.4]:
		for x in [-2.1, 2.1]:
			_add_box(world_root, Vector3(0.50, 0.34, 0.46), Vector3(x, 0.18, z), Color("#665442"), 0.04)
	for index in range(18):
		var side := -1.0 if index % 2 == 0 else 1.0
		var x := side * rng.randf_range(7.2, 9.1)
		var z := rng.randf_range(-9.8, 9.8)
		var crater := _add_cylinder(world_root, rng.randf_range(0.28, 0.62), 0.035, Vector3(x, -0.025, z), Color("#2b3430"), false)
		crater.rotation_degrees.x = 0.0
		var rubble := _add_box(world_root, Vector3(0.65, 0.16, 0.42), Vector3(x + side * 0.55, 0.07, z + 0.35), Color("#716149"), 0.02)
		rubble.rotation_degrees.y = rng.randf_range(-35.0, 35.0)
	for lane_index in range(3):
		var lane_x_value: float = BattleRules.lane_x(lane_index)
		for z in [-3.1, 3.1]:
			var side_of_lane := -1.0 if z < 0.0 else 1.0
			for segment in range(3):
				var bag := _add_box(world_root, Vector3(0.82, 0.28, 0.38), Vector3(lane_x_value + side_of_lane * 1.62, 0.18, z + float(segment - 1) * 0.40), Color("#827454"), 0.0)
				bag.rotation_degrees.y = -8.0 if segment % 2 == 0 else 8.0
	for side in [-1.0, 1.0]:
		var wreck := _add_box(world_root, Vector3(1.5, 0.52, 2.1), Vector3(side * 8.0, 0.34, -5.3 if side < 0.0 else 5.3), Color("#394244"), 0.28)
		wreck.rotation_degrees.y = 18.0 * side
		_add_box(world_root, Vector3(0.92, 0.27, 1.1), wreck.position + Vector3(0.0, 0.38, 0.12), Color("#5a5544"), 0.24)
		_add_box(world_root, Vector3(0.12, 0.1, 0.68), wreck.position + Vector3(0.0, 0.58, -0.72), Color("#706b53"), 0.22)
	for z in [-8.4, 8.4]:
		var beacon_color := Color("#eb8a67") if z < 0.0 else Color("#72d9b5")
		_add_box(world_root, Vector3(0.13, 2.8, 0.13), Vector3(-6.9, 1.4, z), Color("#68746d"), 0.34)
		_add_box(world_root, Vector3(0.72, 0.08, 0.08), Vector3(-6.63, 2.58, z), beacon_color, 0.0, true)

func _make_terrain_texture() -> ImageTexture:
	const texture_size := 256
	var image := Image.create(texture_size, texture_size, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 630194
	for y in range(texture_size):
		for x in range(texture_size):
			var broad := sin(float(x) * 0.041 + sin(float(y) * 0.022) * 1.8) * cos(float(y) * 0.037)
			var small := sin(float(x + y) * 0.31) * cos(float(x - y) * 0.23)
			var noise_value := clampf(0.50 + broad * 0.22 + small * 0.08 + rng.randf_range(-0.13, 0.13), 0.0, 1.0)
			var color := Color("#35453a").lerp(Color("#7b6a4b"), noise_value * 0.72)
			if rng.randf() < 0.035:
				color = color.darkened(rng.randf_range(0.10, 0.24))
			image.set_pixel(x, y, color)
	return ImageTexture.create_from_image(image)

func _create_structures() -> void:
	player_base = BaseStructure.new()
	player_base.name = "PlayerCommandBase"
	add_child(player_base)
	player_base.setup(self, 0, "base", -1, Vector3(0.0, 0.0, 9.4))
	structures.append(player_base)
	enemy_base = BaseStructure.new()
	enemy_base.name = "RivalCommandBase"
	add_child(enemy_base)
	enemy_base.setup(self, 1, "base", -1, Vector3(0.0, 0.0, -9.4))
	structures.append(enemy_base)
	for team in [0, 1]:
		var z := 6.25 if team == 0 else -6.25
		for lane in [0, 2]:
			var tower := BaseStructure.new()
			tower.name = ("Player" if team == 0 else "Enemy") + "Sentry_" + str(lane)
			add_child(tower)
			tower.setup(self, team, "turret", lane, Vector3(BattleRules.lane_x(lane), 0.0, z))
			structures.append(tower)

func _enemy_turn_is_possible() -> bool:
	return enemy_energy >= 2.0

func _material(color: Color, metallic: float = 0.0, roughness: float = 0.68) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.metallic = metallic
	mat.roughness = roughness
	return mat

func _add_box(parent: Node3D, size: Vector3, local_pos: Vector3, color: Color, metallic: float = 0.0, emissive: bool = false) -> MeshInstance3D:
	var mesh_node := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh_node.mesh = box
	mesh_node.position = local_pos
	var mat := _material(color, metallic)
	if emissive:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.emission_enabled = true
		mat.emission = color
		mat.emission_energy_multiplier = 0.38
	mesh_node.material_override = mat
	parent.add_child(mesh_node)
	return mesh_node

func _add_cylinder(parent: Node3D, radius: float, height: float, local_pos: Vector3, color: Color, translucent: bool = false) -> MeshInstance3D:
	var mesh_node := MeshInstance3D.new()
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = radius
	cylinder.bottom_radius = radius
	cylinder.height = height
	mesh_node.mesh = cylinder
	mesh_node.position = local_pos
	var mat := _material(color)
	if translucent:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh_node.material_override = mat
	parent.add_child(mesh_node)
	return mesh_node
