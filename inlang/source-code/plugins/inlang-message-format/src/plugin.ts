import type { LanguageTag, Message, NodeishFilesystemSubset, Plugin } from "@inlang/sdk"
import type { StorageSchema } from "./storageSchema.js"
import { displayName, description } from "../marketplace-manifest.json"
import { PluginSettings } from "./settings.js"
import { detectJsonFormatting } from "@inlang/detect-json-formatting"
import { serializeMessage } from "./parsing/serializeMessage.js"
import { parseMessage } from "./parsing/parseMessage.js"

export const pluginId = "plugin.inlang.messageFormat"

/**
 * Stringify functions of each resource file to keep the formatting.
 */
const stringifyWithFormatting: Record<string, ReturnType<typeof detectJsonFormatting>> = {}

export const plugin: Plugin<{
	[pluginId]: PluginSettings
}> = {
	id: pluginId,
	displayName,
	description,
	settingsSchema: PluginSettings,
	loadMessages: async ({ settings, nodeishFs }) => {
		await maybeMigrateToV2({ settings, nodeishFs })

		const result: Record<string, Message> = {}

		for (const tag of settings.languageTags) {
			for (const pathPattern of settings["plugin.inlang.messageFormat"].pathPatterns) {
				try {
					const file = await nodeishFs.readFile(pathPattern.replace("{languageTag}", tag), {
						encoding: "utf-8",
					})
					stringifyWithFormatting[tag] = detectJsonFormatting(file)
					const json = JSON.parse(file)
					for (const key in json) {
						if (key === "$schema") {
							continue
						}
						// message already exists, add the variants
						else if (result[key]) {
							// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
							const variant = result[key]!.variants.find(({ languageTag }) => languageTag === tag)
							if (variant) {
								const replacement = parseMessage({
									key,
									value: json[key],
									languageTag: tag,
								}).variants.find(({ languageTag }) => languageTag === tag)
								Object.assign(variant, replacement)
							} else {
								// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
								result[key]!.variants = [
									// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
									...result[key]!.variants,
									...parseMessage({ key, value: json[key], languageTag: tag }).variants,
								]
							}
						}
						// message does not exist yet, create it
						else {
							result[key] = parseMessage({ key, value: json[key], languageTag: tag })
						}
					}
				} catch {
					// file does not exist. likely, no translations for the file exist yet.
				}
			}
		}
		return Object.values(result)
	},
	saveMessages: async ({ settings, nodeishFs, messages }) => {
		const result: Record<LanguageTag, Record<string, string>> = {}
		for (const message of messages) {
			const serialized = serializeMessage(message)
			for (const [languageTag, value] of Object.entries(serialized)) {
				if (result[languageTag] === undefined) {
					result[languageTag] = {}
				}
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				result[languageTag]![message.id] = value
			}
		}
		for (const [languageTag, messages] of Object.entries(result)) {
			const [pathPattern] = settings["plugin.inlang.messageFormat"].pathPatterns.slice(-1)
			if (!pathPattern) continue
			const path = pathPattern.replace("{languageTag}", languageTag)
			await createDirectoryIfNotExits({ path, nodeishFs })
			await nodeishFs.writeFile(
				pathPattern.replace("{languageTag}", languageTag),
				(
					stringifyWithFormatting[languageTag] ??
					// default to tab indentation
					// PS sorry for anyone who reads this code
					((data: object) => JSON.stringify(data, undefined, "\t"))
				)({
					$schema: "https://inlang.com/schema/inlang-message-format",
					...messages,
				} satisfies StorageSchema)
			)
		}
	},
}

const createDirectoryIfNotExits = async (args: {
	path: string
	nodeishFs: NodeishFilesystemSubset
}) => {
	try {
		await args.nodeishFs.mkdir(dirname(args.path), { recursive: true })
	} catch {
		// assume that the directory already exists
	}
}

/**
 * Function extracted from https://www.npmjs.com/package/path-browserify
 */
function dirname(path: string) {
	if (path.length === 0) return "."
	let code = path.charCodeAt(0)
	const hasRoot = code === 47 /*/*/
	let end = -1
	let matchedSlash = true
	for (let i = path.length - 1; i >= 1; --i) {
		code = path.charCodeAt(i)
		if (code === 47 /*/*/) {
			if (!matchedSlash) {
				end = i
				break
			}
		} else {
			// We saw the first non-path separator
			matchedSlash = false
		}
	}

	if (end === -1) return hasRoot ? "/" : "."
	if (hasRoot && end === 1) return "//"
	return path.slice(0, end)
}

const maybeMigrateToV2 = async (args: { nodeishFs: NodeishFilesystemSubset; settings: any }) => {
	if (args.settings["plugin.inlang.messageFormat"].filePath == undefined) {
		return
	}
	try {
		const file = await args.nodeishFs.readFile(
			args.settings["plugin.inlang.messageFormat"].filePath,
			{
				encoding: "utf-8",
			}
		)
		await plugin.saveMessages?.({
			messages: JSON.parse(file)["data"],
			nodeishFs: args.nodeishFs,
			settings: args.settings,
		})
		// eslint-disable-next-line no-console
		console.log(
			"Migration to v2 of the inlang-message-format plugin was successful. Please delete the old messages.json file and the filePath property in the settings file of the project."
		)
	} catch {
		// we assume that the file does not exist any more
	}
}
