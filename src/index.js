import { Notice, Plugin, Setting, PluginSettingTab } from 'obsidian';
import { getDailyNoteSettings, getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface'
import UndoModal from './ui/UndoModal'
import RolloverSettingTab from './ui/RolloverSettingTab'


/* EXAMPLE FILE WITH SOME EDGE-CASES
---
Gewicht: 
tags:
- #journal 
---
# Journal 2021-12-23

- some topic
  - some subinfo
  - [ ] an indented todo
    - some info on the intended todo
    - [ ] a sub-todo of the indented todo

## TODOs
- [ ] A todo with some content below
  - --> [a link](https://example.com)
  - some information
  - [ ] a Sub-todo
    - with a sub-content-block, that is followed by an empty line with the wrong level

  - [ ] a sub-todo without a sub-content-block, followed by a line with some white space
  	
- [ ]   A Test-Todo with a tab as separator
- [ ] Test-Todo without extra block
- [ ] Test-Todo at the end of the line
This is NOT a todo in the middle, followed by an empty line

This is after the empty line
* [ ] This is also a todo, but with asterisk instead of a dash
* --> NOT a todo [a link](https://example.com)
* [ ] Test-Todo at the end of the file
*/


const MAX_TIME_SINCE_CREATION = 5000; // 5 seconds

export default class RolloverTodosPlugin extends Plugin {
  async loadSettings() {
    const DEFAULT_SETTINGS = {
      templateHeading: 'none',
      deleteOnComplete: false,
      removeEmptyTodos: false,
      includeSubContent: false,
      debug: false,
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  isDailyNotesEnabled() {
    const dailyNotesPlugin = this.app.internalPlugins.plugins['daily-notes'];
    const dailyNotesEnabled = dailyNotesPlugin && dailyNotesPlugin.enabled;

    const periodicNotesPlugin = this.app.plugins.getPlugin("periodic-notes");
    const periodicNotesEnabled = periodicNotesPlugin && periodicNotesPlugin.settings?.daily?.enabled;

    return dailyNotesEnabled || periodicNotesEnabled;
  }

  getLastDailyNote() {
    const { moment } = window
    const { folder, format } = getDailyNoteSettings();

    // get all notes in directory that aren't null
    const dailyNoteFiles = this.app.vault.getAllLoadedFiles()
      .filter(file => file.hasOwnProperty('path') && file.hasOwnProperty('basename') && file.basename != null)
      .filter(file => file.path.startsWith(folder))

    // remove notes that are from the future
    const todayMoment = moment()
    let dailyNotesTodayOrEarlier = []
    dailyNoteFiles.forEach(file => {
      if (moment(file.basename, format).isSameOrBefore(todayMoment, 'day')) {
        dailyNotesTodayOrEarlier.push(file)
      }
    })

    // sort by date
    const sorted = dailyNotesTodayOrEarlier.sort((a, b) => moment(b.basename, format).valueOf() - moment(a.basename, format).valueOf());
    return sorted[1];
  }

  async handleUnfinishedTodosWithBlocks(file) {
    const content = await this.app.vault.read(file);

    const lines = content.split("\n")
    let inFrontmatter = false
    let curTodo = undefined
    let curLevel = 0
    const todos = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const level = line.match(/^(\t*)/)[1].length

      const todoMatch = line.match(/^(\t*)[-*]\s\[ \]\s.*/)
      const frontmatterMatch = line.match(/^---*.*$/)

      // we skip the frontmatter for rolling over todos
      if (i === 0 && frontmatterMatch) {
        inFrontmatter = true
        continue
      }
      if (inFrontmatter) {
        if (frontmatterMatch) {
          inFrontmatter = false
        }
        continue
      }

      if (curTodo) {
        // we have a current todo and the line is inside its block OR it's just an empty line
        // --> add it to the current todo
        const justWhitespace = line.match(/^\s*\n?$/)
        if (level > curLevel || justWhitespace) {
          curTodo += line + (justWhitespace ? '' : "\n")
          continue
        }

        // we have a current todo and another line starts on the same level
        // --> end the current block and decide if the line is a todo
        if (level <= curLevel) {
          todos.push(curTodo.trimEnd())
          if (todoMatch) {
            curTodo = line + "\n"
            curLevel = level
          } else {
            curTodo = undefined
            curLevel = 0
          }
          continue
        }
      }

      // we don't have a current todo, but the line is a todo
      if (!curTodo && todoMatch) {
        curTodo = line + "\n"
        curLevel = level
      }
    }

    // the last line might have contained a todo that we need to add as well
    if (curTodo) {
      todos.push(curTodo)
    }

    return todos
  }

  async getAllUnfinishedTodos(file) {
    const contents = await this.app.vault.read(file);
    const unfinishedTodosRegex = /(\t*)[-*]\s\[ \]\s.*/g;
    const unfinishedTodos = Array.from(contents.matchAll(unfinishedTodosRegex)).map(([todo]) => todo)

    return unfinishedTodos;
  }

  async sortHeadersIntoHeirarchy(file) {
    ///console.log('testing')
    const templateContents = await this.app.vault.read(file)
    const allHeadings = Array.from(templateContents.matchAll(/#{1,} .*/g)).map(([heading]) => heading)

    if (allHeadings.length > 0) {
      console.log(createRepresentationFromHeadings(allHeadings))
    }
  }

  async rollover(file = undefined) {
    this.logDebug(`Triggered on file "${file.basename}"`)
    /*** First we check if the file created is actually a valid daily note ***/
    const { folder, format } = getDailyNoteSettings()
    let ignoreCreationTime = false

    // Rollover can be called, but we need to get the daily file
    if (file == undefined) {
      const allDailyNotes = getAllDailyNotes()
      file = getDailyNote(window.moment(), allDailyNotes)
      ignoreCreationTime = true
    }
    if (!file) {
      this.logDebug(`"${file.basename}" is NOT the daily file, ignoring.`)
      return;
    }

    // is a daily note
    if (!file.path.startsWith(folder)) {
      this.logDebug(`"${file.basename}" is NOT in the daily notes' folder, ignoring.`)
      return;
    }

    // is today's daily note
    const today = new Date();
    const todayFormatted = window.moment(today).format(format);
    if (todayFormatted !== file.basename) {
      this.logDebug(`"${file.basename}" is NOT today's daily note, ignoring.`)
      return;
    }

    // was just created
    if ((today.getTime() - file.stat.ctime > MAX_TIME_SINCE_CREATION) && !ignoreCreationTime) {
      this.logDebug(`"${file.basename}" was just created, ignoring.`)
      return;
    }

    /*** Next, if it is a valid daily note, but we don't have daily notes enabled, we must alert the user ***/
    if (!this.isDailyNotesEnabled()) {
      new Notice('RolloverTodosPlugin unable to rollover unfinished todos: Please enable Daily Notes, or Periodic Notes (with daily notes enabled).', 10000)
      return
    }

    const { templateHeading, deleteOnComplete, removeEmptyTodos, includeSubContent } = this.settings;

    // check if there is a daily note from yesterday
    const lastDailyNote = this.getLastDailyNote();
    if (lastDailyNote == null) {
      this.logInfo("There doesn't seem to be a daily note from yesterday, aborting.")
      return;
    }

    // TODO: Rollover to subheadings (optional)
    //this.sortHeadersIntoHeirarchy(lastDailyNote)

    // get unfinished todos from yesterday, if exist
    let todos_yesterday = includeSubContent ?
      await this.handleUnfinishedTodosWithBlocks(lastDailyNote) :
      await this.getAllUnfinishedTodos(lastDailyNote);
    this.logDebug('Todos found from yesterday', todos_yesterday);
    if (todos_yesterday.length == 0) {
      this.logInfo(`0 todos found in ${lastDailyNote.basename}.md`)
      return;
    }

    // setup undo history
    let undoHistoryInstance = {
      previousDay: {
        file: undefined,
        oldContent: ''
      },
      today: {
        file: undefined,
        oldContent: ''
      }
    }

    // Potentially filter todos from yesterday for today
    let todosAdded = 0
    let emptiesToNotAddToTomorrow = 0
    let todos_today = !removeEmptyTodos ? todos_yesterday : []
    if (removeEmptyTodos) {
      todos_yesterday.forEach((line, i) => {
        const trimmedLine = (line || "").trim()
        if ((trimmedLine != '- [ ]') && (trimmedLine != '- [  ]')) {
          todos_today.push(line)
          todosAdded++
        } else {
          emptiesToNotAddToTomorrow++
        }
      })
    } else {
      todosAdded = todos_yesterday.length
    }

    // get today's content and modify it
    let templateHeadingNotFoundMessage = ""
    const templateHeadingSelected = (templateHeading !== 'none')

    if (todos_today.length > 0) {
      let dailyNoteContent = await this.app.vault.read(file)
      undoHistoryInstance.today = {
        file: file,
        oldContent: `${dailyNoteContent}`
      }
      const todos_todayString = `\n${todos_today.join('\n')}`

      // If template heading is selected, try to rollover to template heading
      if (templateHeadingSelected) {
        const contentAddedToHeading = dailyNoteContent.replace(templateHeading, `${templateHeading}${todos_todayString}`)
        if (contentAddedToHeading == dailyNoteContent) {
          templateHeadingNotFoundMessage = `Rollover couldn't find '${templateHeading}' in today's daily not. Rolling todos to end of file.`
        } else {
          dailyNoteContent = contentAddedToHeading
        }
      }

      // Rollover to bottom of file if no heading found in file, or no heading selected
      if ((!templateHeadingSelected) || (templateHeadingNotFoundMessage.length > 0)) {
        dailyNoteContent += todos_todayString
      }

      await this.app.vault.modify(file, dailyNoteContent);
    }

    // if deleteOnComplete, get yesterday's content and modify it
    if (deleteOnComplete) {
      let lastDailyNoteContent = await this.app.vault.read(lastDailyNote)
      undoHistoryInstance.previousDay = {
        file: lastDailyNote,
        oldContent: `${lastDailyNoteContent}`
      }
      let lines = lastDailyNoteContent.split('\n')

      for (let i = lines.length; i >= 0; i--) {
        if (todos_yesterday.includes(lines[i])) {
          lines.splice(i, 1)
        }
      }

      const modifiedContent = lines.join('\n')
      await this.app.vault.modify(lastDailyNote, modifiedContent);
    }

    // Let user know rollover has been successful with X todos
    const todosAddedString = todosAdded == 0 ? "" : `- ${todosAdded} todo${todosAdded > 1 ? 's' : ''} rolled over.`
    const emptiesToNotAddToTomorrowString = emptiesToNotAddToTomorrow == 0 ? "" :
      (deleteOnComplete ? `- ${emptiesToNotAddToTomorrow} empty todo${emptiesToNotAddToTomorrow > 1 ? 's' : ''} removed.` : '')
    const part1 = templateHeadingNotFoundMessage.length > 0 ? `${templateHeadingNotFoundMessage}` : ''
    const part2 = `${todosAddedString}${todosAddedString.length > 0 ? " " : ""}`
    const part3 = `${emptiesToNotAddToTomorrowString}${emptiesToNotAddToTomorrowString.length > 0 ? " " : ""}`

    let allParts = [part1, part2, part3]
    let nonBlankLines = []
    allParts.forEach(part => {
      if (part.length > 0) {
        nonBlankLines.push(part)
      }
    })

    const message = nonBlankLines.join('\n')
    if (message.length > 0) {
      new Notice(message, 4000 + (message.length * 3))
    }
    this.undoHistoryTime = new Date()
    this.undoHistory = [undoHistoryInstance]

  }

  logDebug() {
    if (this.settings.debug) {
      console.debug('RDT', ...arguments)
    }
  }

  logInfo() {
    console.info('RDT', ...arguments)
  }

  async onload() {
    await this.loadSettings()

    console.info("Loading Rollover-Daily-Todos plugin")

    this.undoHistory = []
    this.undoHistoryTime = new Date()

    this.addSettingTab(new RolloverSettingTab(this.app, this))

    this.registerEvent(this.app.vault.on('create', async (file) => {
      this.rollover(file)
    }))

    this.addCommand({
      id: "obsidian-rollover-daily-todos-rollover",
      name: "Rollover Todos Now",
      callback: () => this.rollover()
    })

    this.addCommand({
      id: "obsidian-rollover-daily-todos-undo",
      name: "Undo last rollover",
      checkCallback: checking => {
        // no history, don't allow undo
        if (this.undoHistory.length > 0) {
          const now = window.moment()
          const lastUse = window.moment(this.undoHistoryTime)
          const diff = now.diff(lastUse, 'seconds')
          // 2+ mins since use: don't allow undo
          if (diff > (2 * 60)) {
            return false
          }
          if (!checking) {
            new UndoModal(this).open();
          }
          return true
        }
        return false
      }
    })
  }
}
