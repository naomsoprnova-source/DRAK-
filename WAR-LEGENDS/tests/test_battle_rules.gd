extends SceneTree

const Rules = preload("res://scripts/battle_rules.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	_check(Rules.UNIT_DATA.size() == 6, "exactly six defined unit archetypes")
	_check(Rules.can_deploy(2.0, "rifle"), "rifle can be deployed at its exact energy cost")
	_check(not Rules.can_deploy(1.99, "rifle"), "deployment rejects insufficient energy")
	_check(not Rules.can_deploy(10.0, "unknown"), "deployment rejects unknown units")
	_check(Rules.lane_from_x(-9.0) == 0, "left lane maps at left boundary")
	_check(Rules.lane_from_x(0.0) == 1, "center lane maps to center")
	_check(Rules.lane_from_x(8.0) == 2, "right lane maps at right boundary")
	_check(not Rules.lane_is_valid(-1), "negative lane is rejected")
	_check(not Rules.lane_is_valid(3), "lane beyond the arena is rejected")
	_check(Rules.MAX_ENERGY == 10.0 and Rules.ENERGY_REGEN > 0.0, "energy has a capped, positive regeneration rule")
	print("PASS: battle-rules checks complete")
	quit(0)

func _check(condition: bool, description: String) -> void:
	if not condition:
		push_error("FAIL: " + description)
		quit(1)
