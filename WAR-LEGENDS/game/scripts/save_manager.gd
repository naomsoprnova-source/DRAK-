extends RefCounted
class_name SaveManager

const SAVE_PATH := "user://war_legends_save.json"
const TEMP_PATH := "user://war_legends_save.tmp"
const BACKUP_PATH := "user://war_legends_save.bak"
const SAVE_VERSION := 1
const DEFAULT_UNITS := ["rifle", "heavy", "sniper", "engineer", "vehicle", "commander"]

static var _data: Dictionary = {}

static func defaults() -> Dictionary:
	return {
		"version": SAVE_VERSION,
		"wins": 0,
		"losses": 0,
		"mission": 1,
		"best_streak": 0,
		"current_streak": 0,
		"unlocked_units": DEFAULT_UNITS.duplicate(),
		"graphics_preset": "auto",
		"fps_cap": 60,
		"sound_enabled": true
	}

static func load_save() -> Dictionary:
	if not _data.is_empty():
		return _data.duplicate(true)
	var path := ProjectSettings.globalize_path(SAVE_PATH)
	var parsed := _read_path(path)
	if parsed.is_empty():
		parsed = _read_path(ProjectSettings.globalize_path(BACKUP_PATH))
	if parsed.is_empty():
		parsed = defaults()
	else:
		var base := defaults()
		for key in parsed.keys():
			base[key] = parsed[key]
		parsed = base
	if not parsed.get("unlocked_units", null) is Array:
		parsed["unlocked_units"] = DEFAULT_UNITS.duplicate()
	_data = parsed
	return _data.duplicate(true)

static func _read_path(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var result: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return result if result is Dictionary else {}

static func save_data(data: Dictionary) -> bool:
	var clean := data.duplicate(true)
	clean["version"] = SAVE_VERSION
	var temp_path := ProjectSettings.globalize_path(TEMP_PATH)
	var save_path := ProjectSettings.globalize_path(SAVE_PATH)
	var backup_path := ProjectSettings.globalize_path(BACKUP_PATH)
	var file := FileAccess.open(TEMP_PATH, FileAccess.WRITE)
	if file == null:
		push_error("Could not open temporary save file: %s" % error_string(FileAccess.get_open_error()))
		return false
	file.store_string(JSON.stringify(clean, "\t"))
	file.flush()
	file.close()
	if FileAccess.file_exists(SAVE_PATH):
		if FileAccess.file_exists(BACKUP_PATH):
			DirAccess.remove_absolute(backup_path)
		var backup_error := DirAccess.rename_absolute(save_path, backup_path)
		if backup_error != OK:
			push_warning("Could not rotate previous save; keeping new save attempt safe.")
	var rename_error := DirAccess.rename_absolute(temp_path, save_path)
	if rename_error != OK:
		if FileAccess.file_exists(BACKUP_PATH) and not FileAccess.file_exists(SAVE_PATH):
			DirAccess.rename_absolute(backup_path, save_path)
		push_error("Could not atomically replace local save: %s" % error_string(rename_error))
		return false
	_data = clean
	return true

static func record_victory(elapsed_seconds: float) -> Dictionary:
	var data := load_save()
	data["wins"] = int(data.get("wins", 0)) + 1
	data["current_streak"] = int(data.get("current_streak", 0)) + 1
	data["best_streak"] = maxi(int(data.get("best_streak", 0)), int(data["current_streak"]))
	data["mission"] = int(data.get("mission", 1)) + 1
	data["last_result"] = "victory"
	data["last_battle_seconds"] = snappedf(elapsed_seconds, 0.1)
	if not data.get("unlocked_units", null) is Array:
		data["unlocked_units"] = DEFAULT_UNITS.duplicate()
	save_data(data)
	return data

static func record_defeat(elapsed_seconds: float) -> Dictionary:
	var data := load_save()
	data["losses"] = int(data.get("losses", 0)) + 1
	data["current_streak"] = 0
	data["last_result"] = "defeat"
	data["last_battle_seconds"] = snappedf(elapsed_seconds, 0.1)
	save_data(data)
	return data

static func set_option(key: String, value: Variant) -> void:
	var data := load_save()
	data[key] = value
	save_data(data)
