extends SceneTree

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var scene: PackedScene = load("res://scenes/main.tscn")
	_check(scene != null, "main scene loads")
	var game = scene.instantiate()
	root.add_child(game)
	await create_timer(0.8).timeout
	_check(game.player_base != null and game.enemy_base != null, "both command bases exist")
	_check(game.structures.size() == 6, "two command bases and four defensive towers exist")
	_check(game.state == game.State.MENU, "game opens to an Arabic campaign menu, not a blank screen")
	game.start_battle()
	_check(game.is_battle_active(), "start button activates battle")
	var starting_energy: float = game.energy
	_check(game.deploy_unit("rifle", 1, 7.0, 0), "player can deploy a rifle unit")
	_check(is_equal_approx(game.energy, starting_energy - 2.0), "deployment spends unit energy")
	_check(game.player_units.size() == 1, "deployed actor is registered with the player")
	var actor = game.player_units[0]
	var start_z: float = actor.global_position.z
	await create_timer(1.1).timeout
	_check(actor.global_position.z < start_z, "friendly unit autonomously advances toward the enemy")
	game.pause_battle()
	_check(game.state == game.State.PAUSED, "pause state is entered")
	var paused_energy: float = game.energy
	await create_timer(0.7).timeout
	_check(is_equal_approx(game.energy, paused_energy), "energy does not regenerate while paused")
	game.resume_battle()
	_check(game.is_battle_active(), "resume returns to active combat")
	game.queue_free()
	print("PASS: battle-flow checks complete")
	quit(0)

func _check(condition: bool, description: String) -> void:
	if not condition:
		push_error("FAIL: " + description)
		quit(1)
