extends SceneTree
## Runs against the patched web pck: Hoa Hồng Gai uses its own sounds and
## every other plant keeps the old ones.

const ROSE_IDS: Dictionary = {&"rose_thorn_cast": 2, &"rose_thorn_hurt": 2, &"rose_thorn_upgrade": 1,
	&"rose_thorn_evolve": 1, &"rose_thorn_hit": 3, &"rose_thorn_fly": 1}
const TILE := Vector2i(2, 2)
const RUN_FRAMES: int = 600

var _failures: Array[String] = []
var _frame: int = 0
var _audio: Node
var _world: Node2D
var _rose: Plant
var _max_fly_loops: int = 0


func _initialize() -> void:
	# With --main-pack the game's own Audio autoload is already live.
	_audio = root.get_node_or_null(^"Audio")
	if _audio == null:
		_audio = (load("res://scripts/audio/audio_manager.gd") as GDScript).new() as Node
		_audio.name = "Audio"
		root.add_child(_audio)
	_world = Node2D.new()
	root.add_child(_world)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame == 1:
		_check_catalogue()
		_rose = _spawn(&"rose_thorn")
		var zombie := Zombie.new()
		zombie.setup(load("res://data/zombies/basic.tres") as ZombieData, TILE.y)
		zombie.position = _rose.position + Vector2(700.0, 0.0)
		_world.add_child(zombie)
	if _frame > 1 and _frame < RUN_FRAMES:
		_max_fly_loops = maxi(_max_fly_loops, get_nodes_in_group(&"rose_thorn_fly_loop").size())
		return false
	if _frame == RUN_FRAMES:
		_check_combat()
		_check_paths()
		_check_others_unchanged()
		var game_script := load("res://scripts/game/game.gd") as GDScript
		_expect(game_script != null and game_script.can_instantiate(), "game.gd compiles")
		for failure: String in _failures:
			print("FAIL: ", failure)
		print("PASS" if _failures.is_empty() else "FAILED %d" % _failures.size())
		quit(0 if _failures.is_empty() else 1)
	return false


func _spawn(id: StringName) -> Plant:
	var plant := Plant.create(load("res://data/plants/%s.tres" % id) as PlantData, TILE, false)
	_world.add_child(plant)
	return plant


func _check_catalogue() -> void:
	for id: StringName in ROSE_IDS:
		var takes: Array = _audio._streams.get(id, [])
		_expect(takes.size() == ROSE_IDS[id], "%s has %d loaded takes (got %d)" % [id, ROSE_IDS[id], takes.size()])
	var fly := load("res://assets/audio/sfx/rose_thorn_fly_1.wav") as AudioStreamWAV
	_expect(fly != null and fly.loop_mode == AudioStreamWAV.LOOP_FORWARD, "flight sound loops")
	print("catalogue: %d ids loaded" % _audio._streams.size())


func _check_combat() -> void:
	var heard: Array[StringName] = _audio.history
	print("heard: ", heard)
	_expect(heard.has(&"rose_thorn_cast"), "the rose casts with its own sound")
	_expect(not heard.has(&"fire_pea_shoot"), "no more borrowed Hoa Lửa shot")
	_expect(heard.has(&"rose_thorn_hit"), "the orb hits with its own sound")
	_expect(_max_fly_loops > 0 and _max_fly_loops <= 3, "orbs hum in flight, at most 3 (saw %d)" % _max_fly_loops)
	_rose._chip_left = 0.0
	_rose.take_damage(1.0)
	_expect(_audio.history.back() == &"rose_thorn_hurt", "a hit rose cries out")


func _check_paths() -> void:
	_expect(_rose.upgrade_sound() == Sfx.ROSE_THORN_UPGRADE, "rose level-up sound")
	_rose.apply_upgrade(UpgradePaths.Path.NONE)
	_rose.apply_upgrade(UpgradePaths.Path.LIGHT)
	var tail: Array = _audio.history.slice(-2)
	_expect(tail.has(&"rose_thorn_evolve") and tail.has(&"evolve_holy"), "rose evolves with its own sound plus the Light layer, got %s" % [tail])


func _check_others_unchanged() -> void:
	var pea := _spawn(&"peashooter")
	_expect(pea.upgrade_sound() == Sfx.UPGRADE_LEVEL, "peashooter keeps the shared level-up sound")
	var before: int = _audio.history.size()
	pea._chip_left = 0.0
	pea.take_damage(1.0)
	_expect(_audio.history.size() == before, "other plants stay silent when hit")
	pea.apply_upgrade(UpgradePaths.Path.NONE)
	pea.apply_upgrade(UpgradePaths.Path.DARK)
	var tail: Array = _audio.history.slice(-2)
	_expect(tail.has(&"evolve_rise") and tail.has(&"evolve_dark"), "peashooter still evolves with evolve_rise, got %s" % [tail])
	var kinds: Dictionary = Projectile.KINDS
	_expect(kinds[&"fire_pea"]["sound"] == &"burn_tick" and kinds[&"pea"]["sound"] == &"pea_hit", "other shots keep their impact sounds")


func _expect(condition: bool, label: String) -> void:
	if not condition:
		_failures.append(label)
