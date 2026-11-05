extends Node3D
class_name UnitActor

const BattleRules = preload("res://scripts/battle_rules.gd")

var game: Node
var unit_id: String
var team: int = 0
var lane: int = 1
var stats: Dictionary = {}
var health: float = 100.0
var max_health: float = 100.0
var attack_clock: float = 0.0
var brace_clock: float = 0.0
var animation_clock: float = 0.0
var alive: bool = true
var model_root: Node3D
var health_fill: MeshInstance3D
var ring: MeshInstance3D
var base_material: StandardMaterial3D

func setup(controller: Node, id: String, team_id: int, lane_id: int, spawn_z: float) -> void:
	game = controller
	unit_id = id
	team = team_id
	lane = lane_id
	stats = BattleRules.UNIT_DATA[id].duplicate()
	health = float(stats["health"])
	max_health = health
	position = Vector3(BattleRules.lane_x(lane), 0.0, spawn_z)
	_build_model()

func _process(delta: float) -> void:
	if not alive or game == null or not game.is_battle_active():
		return
	animation_clock += delta
	brace_clock = maxf(0.0, brace_clock - delta)
	if model_root != null:
		model_root.position.y = 0.04 + absf(sin(animation_clock * float(stats["speed"]) * 4.0)) * 0.06
		model_root.rotation.z = sin(animation_clock * 3.5) * 0.025
	var target: Node3D = game.get_unit_target(self)
	if target == null or not is_instance_valid(target):
		return
	var distance := global_position.distance_to(target.global_position)
	var attack_range := float(stats["range"])
	if distance <= attack_range:
		attack_clock -= delta
		if attack_clock <= 0.0:
			_attack(target, distance)
			attack_clock = float(stats["cooldown"])
		return
	var target_position := target.global_position
	var direction := -1.0 if target_position.z < global_position.z else 1.0
	var wanted_z := target_position.z - direction * minf(attack_range * 0.78, 2.6)
	if absf(wanted_z - global_position.z) > 0.18:
		global_position.z = move_toward(global_position.z, wanted_z, float(stats["speed"]) * delta)
		if model_root != null:
			model_root.rotation.y = PI if direction > 0.0 else 0.0

func _attack(target: Node3D, distance: float) -> void:
	if unit_id == "engineer":
		var friendly: Node3D = game.get_damaged_friendly_structure(team, global_position, 2.8)
		if friendly != null and is_instance_valid(friendly):
			friendly.repair(13.0)
			game.spawn_projectile(global_position + Vector3.UP, friendly.global_position + Vector3.UP, Color("#75f1cb"), 0.17)
			game.show_callout("engineer_repair", "المهندس يصلح التحصين.")
			return
	var amount := float(stats["damage"])
	if unit_id == "sniper" and distance > 5.0:
		amount *= 1.22
	if unit_id == "vehicle" and target is BaseStructure:
		amount *= 1.65
	amount *= game.get_commander_bonus(team, global_position)
	if target.has_method("take_damage"):
		target.take_damage(amount, team)
	var tint: Color = Color("#a9f4d4") if team == 0 else Color("#ff9876")
	game.spawn_projectile(global_position + Vector3.UP * 1.2, target.global_position + Vector3.UP * 0.8, tint, 0.20)

func take_damage(amount: float, _attacker_team: int = -1) -> void:
	if not alive:
		return
	var protection := 0.24 if unit_id == "heavy" else 0.0
	if brace_clock > 0.0:
		protection = maxf(protection, 0.45)
	health = maxf(0.0, health - amount * (1.0 - protection))
	_update_health_bar()
	if health <= 0.0:
		alive = false
		if game != null:
			game.on_unit_died(self)
		queue_free()

func get_health_ratio() -> float:
	return clampf(health / maxf(max_health, 1.0), 0.0, 1.0)

func _build_model() -> void:
	model_root = Node3D.new()
	model_root.name = "ReadableUnitModel"
	add_child(model_root)
	base_material = _material(stats["color"])
	var team_color := Color("#69d7ae") if team == 0 else Color("#ea8262")
	ring = _make_cylinder(self, 0.62 if unit_id != "vehicle" else 1.12, 0.055, Vector3(0.0, 0.075, 0.0), Color(team_color, 0.30), true)
	if unit_id == "vehicle":
		_build_vehicle(team_color)
	else:
		_build_infantry(team_color)
	_build_health_bar()
	if team == 1:
		model_root.rotation.y = PI

func _build_infantry(team_color: Color) -> void:
	var scale_factor := 1.25 if unit_id == "heavy" else (1.0 if unit_id != "sniper" else 0.93)
	var armor_color: Color = stats["color"]
	var torso_color := armor_color.lerp(team_color, 0.43)
	_add_box(model_root, Vector3(0.58, 0.78, 0.34) * scale_factor, Vector3(0.0, 1.10 * scale_factor, 0.0), torso_color)
	_add_sphere(model_root, 0.25 * scale_factor, Vector3(0.0, 1.72 * scale_factor, 0.0), Color("#d6b493"))
	_add_sphere(model_root, 0.29 * scale_factor, Vector3(0.0, 1.88 * scale_factor, -0.015), armor_color.darkened(0.10))
	_add_box(model_root, Vector3(0.39, 0.30, 0.10) * scale_factor, Vector3(0.0, 1.30 * scale_factor, -0.195), armor_color.darkened(0.28))
	_add_box(model_root, Vector3(0.35, 0.045, 0.04), Vector3(0.0, 1.37 * scale_factor, -0.252), Color("#c4b27b"))
	_add_box(model_root, Vector3(0.16, 0.16, 0.09), Vector3(-0.23, 1.14 * scale_factor, -0.20), armor_color.lightened(0.10))
	_add_box(model_root, Vector3(0.16, 0.16, 0.09), Vector3(0.23, 1.14 * scale_factor, -0.20), armor_color.lightened(0.10))
	_add_box(model_root, Vector3(0.40, 0.14, 0.38), Vector3(0.0, 0.77 * scale_factor, 0.18), Color("#3a4844"))
	_add_box(model_root, Vector3(0.72, 0.17, 0.31), Vector3(0.0, 0.72 * scale_factor, 0.0), armor_color.darkened(0.20))
	_add_box(model_root, Vector3(0.18, 0.57, 0.22) * scale_factor, Vector3(-0.18, 0.39 * scale_factor, 0.0), Color("#38454a"))
	_add_box(model_root, Vector3(0.18, 0.57, 0.22) * scale_factor, Vector3(0.18, 0.39 * scale_factor, 0.0), Color("#38454a"))
	_add_box(model_root, Vector3(0.22, 0.16, 0.08), Vector3(-0.18, 0.48 * scale_factor, -0.14), Color("#827c63"))
	_add_box(model_root, Vector3(0.22, 0.16, 0.08), Vector3(0.18, 0.48 * scale_factor, -0.14), Color("#827c63"))
	_add_box(model_root, Vector3(0.21, 0.12, 0.30), Vector3(-0.18, 0.10, -0.05), Color("#202b2e"))
	_add_box(model_root, Vector3(0.21, 0.12, 0.30), Vector3(0.18, 0.10, -0.05), Color("#202b2e"))
	_add_box(model_root, Vector3(0.16, 0.53, 0.20) * scale_factor, Vector3(-0.39, 1.08 * scale_factor, -0.01), armor_color.darkened(0.16))
	_add_box(model_root, Vector3(0.16, 0.53, 0.20) * scale_factor, Vector3(0.39, 1.08 * scale_factor, -0.01), armor_color.darkened(0.16))
	_add_sphere(model_root, 0.19 * scale_factor, Vector3(-0.39, 1.39 * scale_factor, -0.01), armor_color.lightened(0.08))
	_add_sphere(model_root, 0.19 * scale_factor, Vector3(0.39, 1.39 * scale_factor, -0.01), armor_color.lightened(0.08))
	_add_box(model_root, Vector3(0.14, 0.19, 0.21), Vector3(-0.40, 0.87 * scale_factor, -0.10), Color("#b99d63"))
	_add_box(model_root, Vector3(0.14, 0.19, 0.21), Vector3(0.40, 0.87 * scale_factor, -0.10), Color("#b99d63"))
	_add_box(model_root, Vector3(0.10, 0.22, 0.11), Vector3(0.0, 1.10 * scale_factor, -0.185 * scale_factor), Color("#c7d2ce"))
	_add_box(model_root, Vector3(0.35, 0.13, 0.08), Vector3(0.0, 1.77 * scale_factor, -0.245), Color("#273236"))
	_add_box(model_root, Vector3(0.08, 0.09, 0.09), Vector3(0.0, 1.76 * scale_factor, -0.295), Color("#83d7ca"))
	_add_box(model_root, Vector3(0.09, 0.42, 0.11), Vector3(0.0, 1.08 * scale_factor, 0.24), Color("#374540"))
	_add_box(model_root, Vector3(0.16, 0.11, 0.12), Vector3(0.0, 1.98 * scale_factor, 0.01), Color("#c7aa6b"))
	if unit_id == "heavy":
		_add_box(model_root, Vector3(0.78, 0.29, 0.48), Vector3(0.0, 1.28, 0.02), armor_color.darkened(0.15))
		_add_box(model_root, Vector3(0.42, 0.18, 0.18), Vector3(0.0, 1.97, 0.05), Color("#cfaa68"))
		_add_box(model_root, Vector3(0.72, 0.68, 0.24), Vector3(0.0, 1.08, 0.28), Color("#33423f"))
		_add_box(model_root, Vector3(0.38, 0.12, 0.12), Vector3(0.0, 1.04, -0.25), Color("#dfbe78"))
	elif unit_id == "sniper":
		_add_box(model_root, Vector3(0.12, 0.12, 1.05), Vector3(0.20, 1.35, -0.62), Color("#26383b"))
		_add_box(model_root, Vector3(0.23, 0.16, 0.24), Vector3(0.20, 1.34, -0.12), Color("#d0b36c"))
		_add_box(model_root, Vector3(0.16, 0.08, 0.24), Vector3(0.20, 1.50, -0.40), Color("#223235"))
		_add_box(model_root, Vector3(0.56, 0.50, 0.22), Vector3(0.0, 1.72, 0.22), Color("#52644e"))
	elif unit_id == "engineer":
		_add_box(model_root, Vector3(0.42, 0.52, 0.33), Vector3(0.0, 1.11, 0.24), Color("#d7a34e"))
		_add_box(model_root, Vector3(0.13, 0.58, 0.14), Vector3(-0.50, 1.18, -0.02), Color("#9ca8a2"))
		_add_box(model_root, Vector3(0.19, 0.19, 0.19), Vector3(0.48, 1.25, -0.02), Color("#b0a77f"))
		_add_box(model_root, Vector3(0.12, 0.62, 0.13), Vector3(0.48, 1.40, 0.0), Color("#c4a256"))
	elif unit_id == "commander":
		_add_box(model_root, Vector3(0.64, 0.76, 0.08), Vector3(0.0, 1.06, 0.22), Color("#c95d43"))
		_add_box(model_root, Vector3(0.42, 0.16, 0.18), Vector3(0.0, 1.96, 0.04), Color("#e7c77a"))
		_add_box(model_root, Vector3(0.13, 0.46, 0.09), Vector3(0.0, 1.14, -0.24), Color("#e8d4a0"))
		_add_sphere(model_root, 0.11, Vector3(0.48, 1.46, 0.02), Color("#e3c879"))
	else:
		_add_box(model_root, Vector3(0.11, 0.12, 0.70), Vector3(0.24, 1.30, -0.42), Color("#26383b"))
	_add_sphere(model_root, 0.07, Vector3(0.0, 1.78, -0.235), Color("#73d9d0"))

func _build_vehicle(team_color: Color) -> void:
	var hull := _material(Color("#b76f4a").lerp(team_color, 0.42), 0.36)
	_add_box(model_root, Vector3(1.56, 0.60, 2.18), Vector3(0.0, 0.76, 0.0), hull.albedo_color)
	_add_box(model_root, Vector3(1.10, 0.45, 1.16), Vector3(0.0, 1.20, 0.10), Color("#59665f"))
	_add_box(model_root, Vector3(0.20, 0.18, 1.34), Vector3(0.0, 1.32, -0.98), Color("#c5a873"))
	_add_box(model_root, Vector3(0.30, 0.18, 0.18), Vector3(0.0, 1.27, -0.24), Color("#dfc18a"))
	for side in [-1.0, 1.0]:
		var track := _make_cylinder(model_root, 0.32, 2.08, Vector3(side * 0.77, 0.43, 0.0), Color("#263033"), false)
		track.rotation_degrees.x = 90.0
		for wheel_z in [-0.68, -0.23, 0.23, 0.68]:
			var wheel := _make_cylinder(model_root, 0.15, 0.09, Vector3(side * 0.83, 0.43, wheel_z), Color("#777d76"), false)
			wheel.rotation_degrees.z = 90.0
	_add_box(model_root, Vector3(0.09, 0.16, 0.17), Vector3(-0.53, 1.21, -0.18), Color("#efca75"))

func _build_health_bar() -> void:
	var bar_root := Node3D.new()
	bar_root.position = Vector3(0.0, 2.46 if unit_id != "vehicle" else 1.82, 0.0)
	bar_root.rotation.x = deg_to_rad(-44.0)
	add_child(bar_root)
	_add_box(bar_root, Vector3(1.15, 0.11, 0.05), Vector3.ZERO, Color("#152126"))
	health_fill = _add_box(bar_root, Vector3(1.08, 0.075, 0.04), Vector3(0.0, 0.005, -0.01), Color("#64e0b3"))

func _update_health_bar() -> void:
	if health_fill == null:
		return
	var ratio := get_health_ratio()
	health_fill.scale.x = maxf(0.02, ratio)
	health_fill.position.x = -0.54 * (1.0 - ratio)
	var mat: StandardMaterial3D = health_fill.material_override as StandardMaterial3D
	if mat != null:
		mat.albedo_color = Color("#69dcae") if ratio > 0.5 else (Color("#f0c05e") if ratio > 0.25 else Color("#ee6b59"))

func _add_box(parent: Node3D, size: Vector3, local_pos: Vector3, color: Color) -> MeshInstance3D:
	var mesh_node := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh_node.mesh = box
	mesh_node.position = local_pos
	mesh_node.material_override = _material(color)
	mesh_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	parent.add_child(mesh_node)
	return mesh_node

func _add_sphere(parent: Node3D, radius: float, local_pos: Vector3, color: Color) -> MeshInstance3D:
	var mesh_node := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	sphere.radial_segments = 16
	sphere.rings = 8
	mesh_node.mesh = sphere
	mesh_node.position = local_pos
	mesh_node.material_override = _material(color)
	parent.add_child(mesh_node)
	return mesh_node

func _make_cylinder(parent: Node3D, radius: float, height: float, local_pos: Vector3, color: Color, translucent: bool) -> MeshInstance3D:
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

func _material(color: Color, metallic: float = 0.08) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.68
	mat.metallic = metallic
	return mat
