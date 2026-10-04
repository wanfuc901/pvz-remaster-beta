# Âm thanh Hoa Hồng Gai (Phù thủy gai, `RoseThorn`)

Bộ 6 âm thanh cho cây `scripts/entities/rose_thorn.gd` (art `rose_witch_*`). Hiện bản beta đang cho cây này mượn tiếng `Sfx.FIRE_PEA_SHOOT` của Hoa Lửa. Toàn bộ âm thanh được tổng hợp bằng numpy với chính bộ `tools/gen_audio/dsp.py` của dự án: không dùng sample hay asset bên ngoài, không có giọng người, không có nhạc nền.

## Nội dung thư mục

| File | Vai trò |
| --- | --- |
| `sfx_rose_thorn.py` | Công thức 6 âm thanh. Thả vào `tools/gen_audio/` như các module `sfx_*.py` khác |
| `build_py.patch` | Bản vá `tools/gen_audio/build.py` (nhánh `dev`) để render thêm âm thanh loop và đưa id vào `sfx.gd` |
| `render.py` | Render riêng 6 âm này ra `wav/` mà không đụng phần còn lại của danh mục |
| `wav/` | File đã render sẵn, đặt tên đúng quy ước `assets/audio/sfx/<id>_<n>.wav` |
| `report/` | Bảng mức âm lượng và ảnh phổ |

## Từng âm thanh

| Id (`Sfx.*`) | Nhóm mix | Độ dài | Biến thể | Cấu trúc theo thời gian |
| --- | --- | --- | --- | --- |
| `ROSE_THORN_CAST` (ra đòn) | skill | 0,73 s | 2 | 0-0,24 s dây leo gỗ căng "rẹt" (tiếng ma sát trượt-dính qua cộng hưởng thân cây, nhịp và cao độ tăng dần theo độ căng); 0,16-0,4 s cú quất "vút" (nhiễu dải hẹp quét lên 5,2 kHz); 0,28 s tiếng gai bật, "bụp" năng lượng tròn, cánh hoa bung, hợp âm chuông Rê ngân ngắn |
| `ROSE_THORN_HURT` (chịu đòn) | impact | 0,43 s | 2 | gỗ mềm "cộc" (~520 Hz) và "rắc" ngắn; thân và dây leo rung (xào xạc có tremolo 17 xuống 9 Hz); vài gai và cánh hoa bật ra; một âm ma thuật chập chờn, lệch cao độ, tắt dần như năng lượng bị gián đoạn |
| `ROSE_THORN_UPGRADE` (nâng cấp) | skill | 1,91 s | 1 | 0-0,65 s chồi mọc (7 tiếng "bụp" hữu cơ dồn nhanh) và dây leo lan; 0,45-1,05 s khoảng 22 cánh hoa nở; năng lượng đỏ (pad saw lệch tông) dâng từ Rê 3 lên Rê 4 kèm chuỗi chuông đi lên; 1,22 s bùng lấp lánh mạnh rồi ngân dư |
| `ROSE_THORN_EVOLVE` (tiến hóa) | skill | 3,76 s | 1 | 0-1,4 s rễ và thân gỗ phát triển (rền trầm, tiếng gỗ uốn), gai mới mọc liên tục; 0,95-2,0 s bốn lớp cánh hoa xoay mở lần lượt; 0,3-2,15 s năng lượng đỏ thẫm dâng thành vòng xoáy (tốc độ xoáy 1,5 lên 11 vòng/giây); 2,15 s cú bùng trầm (sub 95 xuống 38 Hz), hợp âm Rê thứ thêm 9 và lấp lánh, đuôi vang dài |
| `ROSE_THORN_HIT` (đòn trúng) | impact | 0,42-0,46 s | 3 | "thụp" chắc (170 xuống 62 Hz); ba gai đâm ngắn và sắc; dây leo siết; "bụp" năng lượng đỏ tròn ở giữa (không có lớp nổ dải rộng nên không giống tiếng súng); cụm 9 cánh hoa nổ tung |
| `ROSE_THORN_FLY` (đòn đang bay) | loop riêng, -27 dB | 1,50 s | 1 | gió xoáy "vùuuu" (xoay 4 vòng mỗi chu kỳ), dây gai sột soạt rất nhẹ, cánh hoa rung trong gió, tiếng ngân Rê-La huyền bí. Không có impact hay cao trào; âm lượng đo theo khung 50 ms nằm trong khoảng -31,6 đến -23,6 dB, dao động đều theo nhịp xoáy |

Mức âm lượng dùng đúng bảng `LEVELS_DB` của `registry.py`, nên đứng cạnh các âm sẵn có không bị lệch. Riêng âm bay để ở -27 dB vì nó kêu liên tục dưới các tiếng khác.

### Vì sao âm bay không đi qua `@sound`

Chuỗi `master()` dùng chung sẽ cắt đuôi và fade 10 ms ở cuối, làm hỏng chỗ nối loop. Nên `rose_thorn_fly` đăng ký bằng `@loop_sound` và được xử lý như sau:

- mọi thành phần (nhiễu, xoáy, rung cánh hoa, tiếng ngân) đều lặp đúng số vòng nguyên trong một chu kỳ; tần số tiếng ngân được khóa vào chu kỳ;
- render 4 chu kỳ rồi giữ chu kỳ cuối, khi bộ lọc và reverb đã ổn định;
- độ dài chu kỳ là bội số của khối lọc (516 x 128 mẫu), nên mọi chu kỳ được lọc y hệt nhau. Sai khác giữa hai chu kỳ liên tiếp đo được là 3e-10, tức là nối khớp tuyệt đối;
- file có chunk `smpl` đánh dấu loop toàn file. Godot nhập ở chế độ mặc định (Loop Mode: Detect From WAV) sẽ tự lặp mà không cần chỉnh import.

## Đã kiểm tra

- Độ dài cả 10 file nằm trong khung yêu cầu (bảng trên).
- Đo âm lượng từng đoạn để chắc từng lớp nghe được. Ví dụ ở ra đòn, tiếng dây căng tăng từ -26 lên -20 dB, cú quất và bung đạt khoảng -16 dB. Ở lượt render đầu tiếng dây căng chỉ khoảng -60 đến -45 dB (gần như không nghe thấy) nên đã sửa; tương tự, tiếng gai ở tiến hóa từng lấn át tiếng rễ và đã được hạ xuống.
- Đã áp `build_py.patch` lên nhánh `dev` (commit `a3958ac`) trên máy ảo và chạy `build.py` toàn bộ: 95 âm, 128 file. Các file âm thanh cũ không đổi byte nào. File sinh ra giống hệt file trong `wav/`.
- Với Godot 4.7.2 headless trên dự án đó: import thành công; `rose_thorn_fly_1.wav` được nhận `loop_mode = 1` (lặp tiến), `loop_end = 66047`; các âm một lần không bị đặt loop. Test `audio_catalog` (133 file), `load_all` và `smoke` đều PASS.
- Đoạn code gắn âm bay ở mục 4 bên dưới đã chạy thử trong Godot: giới hạn 3 quả cầu kêu cùng lúc, vẫn phát sau 2 giây (dài hơn một chu kỳ, tức là đang lặp) và tự tắt khi đạn bị xóa.

## Chưa làm được và giới hạn

- **Chưa gắn vào game.** Mã nguồn có `rose_thorn.gd` (bản beta build từ commit `23ef73e`) không có trên GitHub: repo `pvz-remaster` chỉ có các nhánh `main`, `dev`, `claude/sunflower-produce-anim`, và cả ba đều không có cây này. Bản build beta trong repo này giữ nguyên.
- Mình không nghe được âm thanh. Mọi đánh giá ở trên dựa trên phổ và số đo; cảm nhận cuối cùng cần chủ dự án nghe thử.
- Chưa chạy bộ test đầy đủ và bot các màn, vì nhánh có cây này không có ở đây.

## Bản vá đã đưa lên trang beta

Commit `d253ecb` trên `main` của repo này vá thẳng bản build `23ef73e` (chủ dự án cho phép, chỉ phần âm thanh):

- thêm 10 file âm thanh vào `index.pck`;
- sửa 5 script, chỉ ở chỗ âm thanh (`beta_patch/scripts.patch`): `rose_thorn.gd`, `projectile.gd` (tiếng trúng của đạn hoa hồng), `sfx.gd` (6 id), `plant.gd` và `game.gd` (hàm `_hurt_sound`, `upgrade_sound`, `_evolve_sound` để mỗi cây có tiếng riêng, các cây khác vẫn trả tiếng cũ);
- đổi con số kích thước pck trong `index.html`.

Mọi file khác trong pck giống hệt từng byte. Test `beta_patch/rose_audio_test.gd` chạy trên pck đã vá với Godot 4.7.2 (`godot --headless --fixed-fps 60 --main-pack index.pck --script rose_audio_test.gd`) và đạt.

**Lần build beta sau từ mã nguồn sẽ ghi đè bản vá này.** Muốn giữ âm thanh, áp `beta_patch/scripts.patch` (hoặc làm theo mục dưới) vào mã nguồn gốc trước khi build lại.

## Cách gắn vào game (trên nhánh có `rose_thorn.gd`)

1. Chép `sfx_rose_thorn.py` vào `tools/gen_audio/`, áp `build_py.patch` (`git apply sfx/rose_thorn/build_py.patch`, hoặc sửa tay 3 chỗ trong `build.py`), rồi chạy:
   ```bash
   cd tools/gen_audio && python build.py --report ../../build/audio_report && cd ../..
   git checkout -- tools/gen_audio/__pycache__
   ```
   Lệnh này sinh lại `scripts/audio/sfx.gd` với 6 id `ROSE_THORN_*` (không sửa tay file này).

2. **Ra đòn**, trong `rose_thorn.gd`:
   ```gdscript
   func _shoot_sound() -> StringName:
   	return Sfx.ROSE_THORN_CAST
   ```
   Lớp tiếng Quang Minh/Hắc Ám (`LIGHT_SHOT`/`DARK_SHOT`) của `ShooterPlant` vẫn chồng lên như các cây khác.

3. **Đòn trúng**: trong `KINDS` của `projectile.gd`, ở mục của loại đạn hoa hồng (`_projectile_kind()` của RoseThorn), đặt `"sound": Sfx.ROSE_THORN_HIT`. `_strike()` vẫn qua `target.impact_sound(...)` nên zombie đội nón hay xô vẫn ra tiếng giáp của nó.

4. **Đòn đang bay**: `AudioManager` dùng chung 24 voice và không có hàm dừng theo id, nên một âm loop phát qua `Sound.play` sẽ kêu mãi. Gắn một `AudioStreamPlayer2D` làm con của viên đạn, nó sẽ được giải phóng cùng viên đạn. Trong `rose_thorn.gd`:
   ```gdscript
   const FLY_LOOP: AudioStream = preload("res://assets/audio/sfx/rose_thorn_fly_1.wav")
   const FLY_LOOP_DB: float = -4.0
   ## Nhiều quả cầu cùng kêu chỉ làm đục tiếng; quá số này thì đạn bay im lặng.
   const FLY_LOOP_LIMIT: int = 3
   const FLY_LOOP_GROUP: StringName = &"rose_thorn_fly_loop"
   const FLY_PAN_STRENGTH: float = 0.6
   const FLY_HEARING_DISTANCE: float = 4000.0


   func _attach_fly_loop(shot: Projectile) -> void:
   	if get_tree().get_nodes_in_group(FLY_LOOP_GROUP).size() >= FLY_LOOP_LIMIT:
   		return
   	var hum := AudioStreamPlayer2D.new()
   	hum.stream = FLY_LOOP
   	hum.bus = &"SFX"
   	hum.volume_db = FLY_LOOP_DB
   	hum.panning_strength = FLY_PAN_STRENGTH
   	hum.max_distance = FLY_HEARING_DISTANCE
   	hum.add_to_group(FLY_LOOP_GROUP)
   	# Viên đạn có thể chưa vào cây scene lúc được trang trí; bắt đầu ở điểm
   	# ngẫu nhiên để hai quả cầu bắn liền nhau không kêu trùng pha.
   	hum.ready.connect(func() -> void: hum.play(randf() * FLY_LOOP.get_length()), CONNECT_ONE_SHOT)
   	shot.add_child(hum)
   ```
   Gọi `_attach_fly_loop(shot)` trong `_decorate_shot(shot)`. Bus `SFX` đã khai báo trong `default_bus_layout.tres`, nên chạy được cả trên web.

5. **Chịu đòn**: `Plant.take_damage()` bị gọi liên tục khi zombie gặm, nên phát theo nhịp sẵn có `CHIP_GAP_SEC` (0,35 s). Trong `plant.gd`:
   ```gdscript
   ## Tiếng cây kêu khi bị đánh; rỗng = im lặng như trước.
   func _hurt_sound() -> StringName:
   	return &""
   ```
   và trong khối `if _chip_left <= 0.0:` của `take_damage()`:
   ```gdscript
   	var hurt := _hurt_sound()
   	if hurt != &"":
   		Sound.play(hurt, position)
   ```
   `RoseThorn` override `_hurt_sound()` trả `Sfx.ROSE_THORN_HURT`.

6. **Nâng cấp** (cấp 2): `game.gd` đang phát cứng `Sfx.UPGRADE_LEVEL`. Thêm vào `Plant`:
   ```gdscript
   func upgrade_sound() -> StringName:
   	return Sfx.UPGRADE_LEVEL
   ```
   đổi dòng trong `game.gd` thành `Sound.play(plant.upgrade_sound(), plant.position)`, rồi `RoseThorn` override trả `Sfx.ROSE_THORN_UPGRADE`.

7. **Tiến hóa** (cấp 3): `Plant._evolve()` đang phát `EVOLVE_RISE` rồi lớp `EVOLVE_HOLY`/`EVOLVE_DARK`. Thêm `func _evolve_sound() -> StringName: return Sfx.EVOLVE_RISE` vào `Plant`, dùng nó thay cho `Sfx.EVOLVE_RISE` trong `_evolve()`, và `RoseThorn` override trả `Sfx.ROSE_THORN_EVOLVE`. Đề xuất giữ lớp Quang Minh/Hắc Ám để dạng tiến hóa vẫn có màu riêng, nhưng hạ khoảng -6 dB (`Sound.play(..., position, -6.0)`) cho tiếng hoa hồng nổi lên trước. Đây là đề xuất, chưa nghe thử trong trận.

8. Chạy toàn bộ test theo `docs/handover/05-WORKFLOW.md`.

## Render lại

```bash
pip install numpy scipy soundfile matplotlib
python sfx/rose_thorn/render.py --gen-audio <pvz-remaster>/tools/gen_audio --report sfx/rose_thorn/report
```

Seed cố định theo tên âm và biến thể, nên render lại cho ra đúng các file này, trừ khi công thức đổi.
