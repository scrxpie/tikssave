client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, id] = interaction.customId.split('_');

  if (action === 'info') {
    const video = await VideoLink.findOne({ shortId: id });
    if (!video) return interaction.reply({ content: 'Video not found.', ephemeral: true });
    const info = `**Username:** ${video.username}\n**Title:** ${video.title}\n**Duration:** ${video.duration || 'N/A'}\n**Created:** ${video.createdAt}`;
    return interaction.reply({ content: info, ephemeral: true });
  }

  if (action === 'delete') {
    if (interaction.user.id !== id) {
      return interaction.reply({ content: 'You cannot delete this.', ephemeral: true });
    }
    await interaction.message.delete().catch(console.error);
  }
});
client.once('ready', () => {
  console.log(`${client.user.tag} aktif!`);
});
en son boyle
