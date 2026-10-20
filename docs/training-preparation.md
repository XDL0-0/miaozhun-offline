# Training preparation and projected order labels

Entry now follows resource readiness, rather than merely scene construction. The
gate loads the active and return weapons plus the knife, waits for their selected
appearances and equip clips, prepares selected skin audio/banner images, and
compiles and draws their materials before the GPU fence. Native muzzle particle
batches allocate and upload their real buffers during preparation. Preparing a
batch is serialized, and ordinary idle renders cannot clear its draw range while
shader compilation is pending.

For native effects that retain previous shots, the pool covers overlapping
emitters using source lifetime bounds, burst/rate timing and the weapon's fastest
fire interval, including ADS changes and the renderer's update-step margin.
Destroy-previous skin effects retain their one-shot allocation. The calculation
uses no live RNG or simulation. This deliberately moves a few MiB of current-gun
CPU/GPU buffers into loading rather than allocating them during a spray; it does
not preload every weapon. Tests run the retained native particle simulator to
check that the planned pool covers continuous fire and alternating ADS.

Spawner delay means the real humanoid skeletons may not exist during the idle
preview. Their first-wave instances now remain in a scene-owned ready pool after
prewarming, and native spawning consumes those exact instances. Reservation counts
come from spawner concurrency and the native dispatcher's bounded concurrency for
each candidate template. Existing preview actors upload their own bone textures
too. Cancellation releases uncommitted reservations; clearing or disposing a
scene releases unused instances, and removing an active actor releases its unique
skeleton. Native animation and culling settings are preserved. Later respawns
outside the initial reserve may allocate normally.

The muzzle light and tone composite passes also compile and draw at the original
output target. Warming only the intermediate linear texture misses the final
output-color-space shader variants. A scissored one-pixel draw during loading
warms the actual output variant; render state is restored and the subsequent
world prewarm redraws the frame before readiness is published.

The auxiliary route planner completes its initial work before entry. Head-line
geometry is included in the world prewarm. Enabling the guide or changing a skin
while waiting invalidates the prepared selection. Preparation repeats until both
the selection identity and model revisions are stable. Obsolete decodes are
drained; an obsolete failure cannot fail a successful replacement. Failed current
loads expose the existing retry action. No simulation advances while preparing.

The start prompt and training countdown share this readiness state. Their hint
nodes retain a stable Vue block shape when readiness changes, so restarting does
not alter the parent's dynamic-child count.

The native audio session also prepares silently during loading. Live-context and
master-gain construction, local sound decoding and the original deterministic
noise buffer are prepared before entry. This starts no sound sources and does
not wait for autoplay permission. The normal start gesture resumes the prepared
context; it does not construct a new context on the first shot. Muted settings
remain respected.

Order badges are painted synchronously after the render camera and interpolated
actor roots have been applied, before the world is presented. Their projection
replaces snapshot translation with the rendered actor translation while retaining
the head offset. They no longer own a separate RAF loop. Invalid, dead, disabled
or off-screen labels hide immediately and clear their old transform; the former
150 ms opacity transition is removed. Route sorting and kill simulation are
unchanged.

`node scripts/create-training-profile.mjs` temporarily installs a query-only
diagnostic panel and deterministic native-engine fixture. Open
`/aim?__offlineProfile=1`, enter a scene and use its automatic-test button. It runs
fixed input for firing, reloading, equipping the knife, attacking, returning to the
primary and inspecting. Fixture rounds discard the replay recorder and intercept
result persistence, including after the fixture stops; settings are not changed.
The live DOM holds only a compact summary, and stops updating when a run ends.
Full reports are generated on demand into a hidden text field or a download.
`--profile-only` installs measurements without the fixture. `--restore` restores
the backed-up modules and entry and removes the diagnostic module. Full ESM parsing
must succeed before temporary transforms are written.

These diagnostics measure browser RAF intervals and synchronous native update /
render submission CPU. They count texture uploads and shader initialization, but
do not measure GPU execution time or exact resident memory. The panel and hooks
add overhead. A deterministic fixture is not a manual gameplay FPS benchmark.
Normal GPU capability probes may intentionally lose a temporary context; such an
event alone is not evidence of a rendering failure.

The final [validation record](training-validation.json) covers 212 passing tests,
the offline resource closure, and a ten-second native-engine fixture in the
DDY Ascent scene with Champions 2023. In the staged audio comparison, the first
shot's update CPU fell from 39.2 to 3.7 ms, including audio from 35.9 to 0.3 ms.
The final run held 91 programs, 119 textures and 573 geometries from its first to
last render; no initialization-related slow frames were recorded. Render-submit
CPU averaged 3.884 ms with an 8.8 ms maximum. The observed RAF intervals still
included a 51.6 ms gap, so these results do not establish zero stutter or a manual
gameplay FPS guarantee. The temporary fixture and diagnostic entry are removed
from the normal delivery.
