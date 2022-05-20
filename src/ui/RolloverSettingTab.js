import {Setting, PluginSettingTab} from 'obsidian';
import {getDailyNoteSettings} from 'obsidian-daily-notes-interface'

export default class RolloverSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    async getTemplateHeadings() {
        const {template} = getDailyNoteSettings()
        if (!template) return [];

        let file = this.app.vault.getAbstractFileByPath(template)
        if (file == null) {
            file = this.app.vault.getAbstractFileByPath(template + '.md')
        }

        const templateContents = await this.app.vault.read(file)
        const allHeadings = Array.from(templateContents.matchAll(/#{1,} .*/g)).map(([heading]) => heading)
        return allHeadings;
    }

    async display() {
        const templateHeadings = await this.getTemplateHeadings()

        this.containerEl.empty()
        new Setting(this.containerEl)
            .setName('Template heading')
            .setDesc('Which heading from your template should the todos go under')
            .addDropdown((dropdown) => dropdown
                .addOptions({
                    ...templateHeadings.reduce((acc, heading) => {
                        acc[heading] = heading;
                        return acc;
                    }, {}),
                    'none': 'None'
                })
                .setValue(this.plugin?.settings.templateHeading)
                .onChange(value => {
                    this.plugin.settings.templateHeading = value;
                    this.plugin.saveSettings();
                })
            )

        new Setting(this.containerEl)
            .setName('Delete todos from previous day')
            .setDesc(`Once todos are found, they are added to Today's Daily Note. If successful, they are deleted from Yesterday's Daily note. Enabling this is destructive and may result in lost data. Keeping this disabled will simply duplicate them from yesterday's note and place them in the appropriate section. Note that currently, duplicate todos will be deleted regardless of what heading they are in, and which heading you choose from above.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.deleteOnComplete || false)
                .onChange(value => {
                    this.plugin.settings.deleteOnComplete = value;
                    this.plugin.saveSettings();
                })
            )

        new Setting(this.containerEl)
            .setName('Remove empty todos in rollover')
            .setDesc(`If you have empty todos, they will not be rolled over to the next day.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.removeEmptyTodos || false)
                .onChange(value => {
                    this.plugin.settings.removeEmptyTodos = value;
                    this.plugin.saveSettings();
                })
            )

        new Setting(this.containerEl)
            .setName('Include a todos content block')
            .setDesc(`If a todo has more content in the next lines, it will be rolled over as well`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeSubContent || false)
                .onChange(value => {
                    this.plugin.settings.includeSubContent = value;
                    this.plugin.saveSettings();
                })
            )

        new Setting(this.containerEl)
            .setName('Prefix for any moved todo')
            .setDesc(`If you would like a prefix on each of the items moved over this is the place to add it. Any value here will be used.`)
            .addText(component =>
                component
                    .setValue(this.plugin.settings.prefix ?? null)
                    .onChange((value) => {
                        this.plugin.settings.prefix = value
                        this.plugin.saveData(this.plugin.settings);
                    })
            )

        new Setting(this.containerEl)
            .setName('Debug')
            .setDesc(`Adds some debug information to the console - access via CTRL+SHIFT+i, switch to console and check the filters, if the "debug" log level is active`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debug || false)
                .onChange(value => {
                    this.plugin.settings.debug = value;
                    this.plugin.saveSettings();
                })
            )
    }
}
