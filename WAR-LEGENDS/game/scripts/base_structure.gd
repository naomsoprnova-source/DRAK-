extends Node3D
class_name BaseStructure

var game: Node
var team: int = 0
var kind: String = "turret"
var lane: int = -1
var health: float = 360.0
var max_health: float = 360.0
var attack_clock: float = 0.6
var alive: bool = true
var health_fill: MeshInstance3D
var turret_head: MeshInstance3D

func setup(controller: Node, team_id: int, kind_id: String, lane_id: int, world_pos: Vector3) -> void:
	game = controller
	team = team_id
	kind = kind_id
	lane = lane_id
	position = world_pos
	if kind == "base":
		health = 1350.0
		max_health = health
		_build_base()
	else:
		health = 360.0
		max_health = health
		_build_turret()
	_build_health_bar()

func _process(delta: float) -> void:
	if not alive or kind != "turret" or game == null or not game.is_battle_active():
		return
	attack_clock -= delta
	if attack_clock > 0.0:
		return
	var target: UnitActor = game.get_nearest_enemy_unit(team, global_position, 5.4, lane)
	if target == null:
		attack_clock = 0.35
		return
	attack_clock = 1.35
	if is_instance_valid(turret_head):
		turret_head.rotation.y = PI if target.global_position.z > global_position.z else 0.0
	target.take_damage(15.0, team)
	game.spawn_projectile(global_position + Vector3.UP * 1.5, target.global_position + Vector3.UP * 1.0, Color("#ffd27b") if team == 0 else Color("#ff9873"), 0.22)

func take_damage(amount: float, attacker_team: int = -1) -> void:
	if not alive:
		return
	var reduction := 0.18 if kind == "base" else 0.0
	health = maxf(0.0, health - amount * (1.0 - reduction))
	_update_health_bar()
	if health <= 0.0:
		alive = false
		if kind == "base":
			if game != null:
				game.on_base_destroyed(team, attacker_team)
		else:
			if game != null:
				game.on_structure_destroyed(self)
			queue_free()

func repair(amount: float) -> void:
	if alive:
		health = minf(max_health, health + amount)
		_update_health_bar()

func get_health_ratio() -> float:
	return clampf(health / maxf(max_health, 1.0), 0.0, 1.0)

func _build_base() -> void:
	var main_color := Color("#304d55") if team == 0 else Color("#59403a")
	var trim := Color("#65d6b1") if team == 0 else Color("#ef8868")
	_add_box(Vector3(3.8, 1.6, 2.6), Vector3(0.0, 0.8, 0.0), main_color)
	_add_box(Vector3(2.55, 1.1, 2.05), Vector3(0.0, 2.08, -0.05), main_color.lightened(0.12))
	_add_box(Vector3(4.1, 0.18, 2.85), Vector3(0.0, 1.62, 0.0), trim.darkened(0.1))
	_add_box(Vector3(0.32, 0.85, 0.20), Vector3(0.0, 1.65, -1.23), trim)
	_add_box(Vector3(1.0, 0.12, 0.12), Vector3(0.0, 2.1, -1.15), trim)
	for side in [-1.0, 1.0]:
		_add_box(Vector3(0.35, 1.2, 1.55), Vector3(side * 1.68, 1.35, 0.05), main_color.darkened(0.12))
		_add_box(Vector3(0.52, 0.16, 0.62), Vector3(side * 1.68, 2.02, 0.05), trim)

func _build_turret() -> void:
	var base_color := Color("#42555a") if team == 0 else Color("#634d44")
	var accent := Color("#68d7ae") if team == 0 else Color("#ed8668")
	_add_box(Vector3(1.55, 0.58, 1.55), Vector3(0.0, 0.36, 0.0), base_color)
	_add_box(Vector3(1.15, 0.92, 1.10), Vector3(0.0, 1.05, 0.0), base_color.lightened(0.12))
	var turret := MeshInstance3D.new()
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 0.50
	cylinder.bottom_radius = 0.58
	cylinder.height = 0.56
	turret.mesh = cylinder
	turret.position = Vector3(0.0, 1.77, 0.0)
	turret.material_override = _material(accent.darkened(0.12), 0.28)
	add_child(turret)
	turret_head = turret
	_add_box(Vector3(0.18, 0.16, 0.94), Vector3(0.0, 1.74, -0.58), accent)
	_add_box(Vector3(0.28, 0.10, 0.28), Vector3(0.0, 1.10, -0.62), accent)
	_add_box(Vector3(0.13, 0.60, 0.16), Vector3(0.0, 2.14, 0.0), Color("#d6c089"))

func _build_health_bar() -> void:
	var bar_root := Node3D.new()
	bar_root.position = Vector3(0.0, 3.05 if kind == "base" else 2.55, 0.0)
	bar_root.rotation.x = deg_to_rad(-44.0)
	add_child(bar_root)
	var width := 3.3 if kind == "base" else 1.85
	var bg := _add_bar_box(bar_root, Vector3(width, 0.18, 0.05), Vector3.ZERO, Color("#142126"))
	bg.name = "HealthBackground"
	health_fill = _add_bar_box(bar_root, Vector3(width - 0.12, 0.12, 0.04), Vector3(0.0, 0.005, -0.01), Color("#68ddaf"))

func _update_health_bar() -> void:
	if health_fill == null:
		return
	var ratio := get_health_ratio()
	var full_width := 3.18 if kind == "base" else 1.73
	health_fill.scale.x = maxf(0.02, ratio)
	health_fill.position.x = -full_width * 0.5 * (1.0 - ratio)
	var mat: StandardMaterial3D = health_fill.get_surface_override_material(0)
	if mat != null:
		mat.albedo_color = Color("#69dcad") if ratio > 0.5 else (Color("#f0bd60") if ratio > 0.25 else Color("#ec6c58"))

func _add_box(size: Vector3, local_pos: Vector3, color: Color) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	node.mesh = box
	node.position = local_pos
	node.material_override = _material(color)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(node)
	return node

func _add_bar_box(parent: Node3D, size: Vector3, local_pos: Vector3, color: Color) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	node.mesh = box
	node.position = local_pos
	node.material_override = _material(color)
	parent.add_child(node)
	return node

func _material(color: Color, metallic: float = 0.1) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.6
	material.metallic = metallic
	return material
