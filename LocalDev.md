# LocalDev

Simple tips for developing locally. This may not work for others and may need to be augmented.

### Install

I have been using `yarn` to install as `npm` has stalled on some obsidian plugins.

```shell
yarn
```

### Run Dev Mode

This watches for changes and builds in a non-minified way. The built files for this project are:

- `/manifest.json`
- `/main.js`

```shell
npm run dev
```

These files need to be moved to the `obsidian-vault/plugins/this-plugin` folder.

### Move Files

We need to move the files into place.

```shell
cp manifest.json main.js ~/brain/.obsidian/plugins/bladn-rollover/.; echo "files copied"
```

There is also a script that will do this. `ALERT`: There is an assumption of file location in 
this script. Edit the `package.json` file to update for different locations.
```shell
npm run copy
```
### Reloading Obsidian

Once you've moved the files you need to reload Obsidian. This is in the command pallet under "Reload app"