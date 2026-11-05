extends SceneTree

const Save = preload("res://scripts/save_manager.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var seed_data: Dictionary = Save.defaults()
	_check(seed_data.get("wins") == 0, "fresh progress begins at zero wins")
	_check(seed_data.get("unlocked_units", []).size() == 6, "fresh save records the six available units")
	seed_data["wins"] = 4
	seed_data["mission"] = 5
	seed_data["graphics_preset"] = "high"
	_check(Save.save_data(seed_data), "save writes successfully")
	Save._data = {}
	var loaded: Dictionary = Save.load_save()
	_check(int(loaded.get("wins", -1)) == 4, "wins survive a disk reload")
	_check(int(loaded.get("mission", -1)) == 5, "campaign mission survives a disk reload")
	_check(str(loaded.get("graphics_preset", "")) == "high", "graphics choice survives a disk reload")
	var win_record: Dictionary = Save.record_victory(92.4)
	_check(int(win_record.get("wins", 0)) == 5, "victory increments the persistent win count")
	_check(int(win_record.get("mission", 0)) == 6, "victory advances campaign progress")
	_check(win_record.get("last_result") == "victory", "result is recorded locally")
	_cleanup()
	print("PASS: save-manager checks complete")
	quit(0)

func _cleanup() -> void:
	Save._data = {}
	for path in [Save.SAVE_PATH, Save.TEMP_PATH, Save.BACKUP_PATH]:
		var absolute := ProjectSettings.globalize_path(path)
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(absolute)

func _check(condition: bool, description: String) -> void:
	if not condition:
		push_error("FAIL: " + description)
		_cleanup()
		quit(1)
