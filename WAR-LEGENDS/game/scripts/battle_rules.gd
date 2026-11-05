extends RefCounted
class_name BattleRules

const LANES: Array[float] = [-4.2, 0.0, 4.2]
const MAX_ENERGY: float = 10.0
const ENERGY_REGEN: float = 0.72
const PLAYER_DEPLOY_MIN_Z: float = 2.6

const UNIT_DATA := {
	"rifle": {"name": "مشاة", "role": "متوازنون", "cost": 2, "health": 105.0, "damage": 18.0, "range": 4.1, "cooldown": 0.88, "speed": 2.05, "color": Color("#66d7ae"), "abbr": "م"},
	"heavy": {"name": "مدرّع", "role": "خط أمامي", "cost": 3, "health": 235.0, "damage": 27.0, "range": 2.15, "cooldown": 1.12, "speed": 1.32, "color": Color("#54a99b"), "abbr": "د"},
	"sniper": {"name": "قنّاص", "role": "دعم بعيد", "cost": 3, "health": 82.0, "damage": 40.0, "range": 8.0, "cooldown": 1.95, "speed": 1.42, "color": Color("#a0d98a"), "abbr": "ق"},
	"engineer": {"name": "مهندس", "role": "إصلاح ودعم", "cost": 2, "health": 115.0, "damage": 12.0, "range": 2.6, "cooldown": 1.15, "speed": 1.72, "color": Color("#e1bd69"), "abbr": "هـ"},
	"vehicle": {"name": "مركبة", "role": "كسر التحصينات", "cost": 5, "health": 390.0, "damage": 46.0, "range": 3.5, "cooldown": 1.65, "speed": 0.92, "color": Color("#cf8357"), "abbr": "آ"},
	"commander": {"name": "قائد", "role": "تعزيز الحلفاء", "cost": 4, "health": 175.0, "damage": 25.0, "range": 4.3, "cooldown": 1.0, "speed": 1.62, "color": Color("#d9b36a"), "abbr": "ق"}
}

static func can_deploy(energy: float, unit_id: String) -> bool:
	if not UNIT_DATA.has(unit_id):
		return false
	return energy >= float(UNIT_DATA[unit_id]["cost"])

static func lane_from_x(x: float) -> int:
	var best_lane := 0
	var best_distance := INF
	for i in range(LANES.size()):
		var distance: float = absf(x - LANES[i])
		if distance < best_distance:
			best_distance = distance
			best_lane = i
	return best_lane

static func lane_x(lane: int) -> float:
	return LANES[clampi(lane, 0, LANES.size() - 1)]

static func lane_is_valid(lane: int) -> bool:
	return lane >= 0 and lane < LANES.size()
