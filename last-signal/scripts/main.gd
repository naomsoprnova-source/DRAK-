extends Node3D

var player: CharacterBody3D
var camera: Camera3D
var yaw := 0.0
var pitch := -0.15
var health := 100
var ammo := 30
var enemies: Array[Node3D] = []
var hud: CanvasLayer

func _ready() -> void:
	_setup_world()
	_spawn_player()
	_spawn_enemies()
	_setup_hud()

func _setup_world() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	e.sky = Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("#24394a")
	sky_mat.sky_horizon_color = Color("#d1a879")
	e.sky.sky_material = sky_mat
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.65,0.65,0.65)
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48,-25,0)
	sun.shadow_enabled = true
	add_child(sun)
	_add_box(Vector3(0,-0.5,0),Vector3(130,1,130),Color("#9b805d"))
	for i in range(18):
		var x := randf_range(-52,52)
		var z := randf_range(-52,52)
		if Vector2(x,z).length() > 12:
			_add_box(Vector3(x,1,z),Vector3(randf_range(2,6),2,randf_range(2,6)),Color("#55534a"))

func _add_box(pos: Vector3, size: Vector3, color: Color) -> void:
	var body := StaticBody3D.new()
	body.position = pos
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.9
	mesh.material_override = mat
	body.add_child(mesh)
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	body.add_child(col)
	add_child(body)

func _spawn_player() -> void:
	player = CharacterBody3D.new()
	player.position = Vector3(0,1,18)
	var col := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.45
	capsule.height = 1.8
	col.shape = capsule
	col.position.y = 0.9
	player.add_child(col)
	var visual := MeshInstance3D.new()
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.42
	mesh.height = 1.8
	visual.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("#344d4a")
	visual.material_override = mat
	visual.position.y = 0.9
	player.add_child(visual)
	var pivot := Node3D.new()
	pivot.position.y = 1.45
	player.add_child(pivot)
	camera = Camera3D.new()
	camera.position = Vector3(0.7,0.45,4.2)
	camera.current = true
	pivot.add_child(camera)
	add_child(player)

func _spawn_enemies() -> void:
	for i in range(6):
		var enemy := Node3D.new()
		enemy.position = Vector3(randf_range(-40,40),0,randf_range(-40,5))
		var mesh := MeshInstance3D.new()
		var capsule := CapsuleMesh.new()
		capsule.radius = 0.45
		capsule.height = 1.8
		mesh.mesh = capsule
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color("#8d3931")
		mesh.material_override = mat
		mesh.position.y = 0.9
		enemy.add_child(mesh)
		add_child(enemy)
		enemies.append(enemy)

func _setup_hud() -> void:
	hud = CanvasLayer.new()
	add_child(hud)
	var label := Label.new()
	label.text = "LAST SIGNAL  |  صحة: 100  |  ذخيرة: 30\nتحرّك بالجهة اليسرى واسحب للتصويب — اضغط إطلاق"
	label.position = Vector2(18,18)
	label.add_theme_font_size_override("font_size",20)
	hud.add_child(label)

func _physics_process(delta: float) -> void:
	if player == null: return
	var move := Vector2.ZERO
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP): move.y -= 1
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN): move.y += 1
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT): move.x -= 1
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT): move.x += 1
	var dir := Vector3(move.x,0,move.y).normalized()
	player.velocity.x = dir.x * 5.0
	player.velocity.z = dir.z * 5.0
	if not player.is_on_floor(): player.velocity.y -= 22.0 * delta
	player.move_and_slide()
	for enemy in enemies:
		if is_instance_valid(enemy):
			var toward := player.global_position - enemy.global_position
			toward.y = 0
			if toward.length() > 3: enemy.position += toward.normalized() * delta * 1.1

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		camera.rotation.y -= event.relative.x * 0.004
		camera.rotation.x = clamp(camera.rotation.x - event.relative.y * 0.004,-0.8,0.5)
