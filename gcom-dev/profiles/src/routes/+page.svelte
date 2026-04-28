<script>
	let profiles = [];
	let selectedProfile = null;
	// Placeholder: In a real app, load profiles from localStorage, file, or API
	profiles = [
		{ id: 'ortur-lm2pro-s2', label: 'Ortur Laser Master 2 Pro S2', description: 'Laser engraver profile', macros: { tool_on: ["SEND 'M3 S{spindlespeed}' REQUIRE_OK"] } },
		{ id: 'custom', label: 'Custom Machine', description: 'Create your own profile', macros: {} }
	];
	selectedProfile = profiles[0];
</script>

<main>
	<h1>GCOM Machine Profile Editor</h1>
	<p>Edit, create, and export machine profiles for GCOM and GRBL-based devices.</p>

	<label for="profile-select"><strong>Select Profile:</strong></label>
	<select id="profile-select" bind:value={selectedProfile}>
		{#each profiles as profile}
			<option value={profile}>{profile.label}</option>
		{/each}
	</select>

	{#if selectedProfile}
		<section style="margin-top:2rem;">
			<h2>{selectedProfile.label}</h2>
			<p>{selectedProfile.description}</p>
			<h3>Macros</h3>
			<ul>
				{#each Object.entries(selectedProfile.macros) as [macro, lines]}
					<li><strong>{macro}:</strong>
						<pre>{lines.join('\n')}</pre>
					</li>
				{/each}
			</ul>
			<button disabled title="Coming soon">Edit Profile</button>
			<button disabled title="Coming soon">Export JSON</button>
		</section>
	{/if}
</main>

<style>
main {
	max-width: 600px;
	margin: 2rem auto;
	padding: 1rem;
	background: #fff;
	border-radius: 8px;
	box-shadow: 0 2px 8px rgba(0,0,0,0.07);
}
h1 {
	font-size: 2rem;
	margin-bottom: 1rem;
}
select {
	margin: 0 0 1rem 0;
	padding: 0.5rem;
	font-size: 1rem;
}
section {
	background: #f9f9f9;
	border-radius: 6px;
	padding: 1rem;
	margin-top: 1rem;
}
pre {
	background: #eee;
	padding: 0.5rem;
	border-radius: 4px;
	font-size: 0.95rem;
}
button {
	margin-right: 1rem;
	margin-top: 1rem;
	padding: 0.5rem 1rem;
	font-size: 1rem;
	border-radius: 4px;
	border: none;
	background: #0070f3;
	color: #fff;
	cursor: not-allowed;
	opacity: 0.7;
}
</style>
