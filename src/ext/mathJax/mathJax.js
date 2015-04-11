angular.module('classeur.ext.mathJax', [])
	.directive('clMathJax', function($window, clEditorSvc) {
		var config, isInit, encloseMath, cacheDict;
		clEditorSvc.onInitConverter(75, function(converter) {
			cacheDict = {};

			if (config) {
				isInit || init();
				converter.hooks.chain("preConversion", removeMath);
				converter.hooks.chain("postConversion", replaceMath);

				clEditorSvc.onAsyncPreview(function(cb) {
					if (!UpdateMJ) {
						return cb();
					}
					var tex2jax = $window.MathJax.Extension.tex2jax;
					if (!encloseMath && tex2jax) {
						encloseMath = tex2jax.encloseMath;
						tex2jax.encloseMath = function(element) {
							element = element.parentNode;
							if (element) {
								var className = element.className;
								element.className = className ? className + ' contains-mathjax' : 'contains-mathjax';
								element.htmlBeforeTypeSet = element.innerHTML;
							}
							return encloseMath.apply(tex2jax, arguments);
						};
					}

					Array.prototype.forEach.call(document.querySelectorAll('.classeur-preview-section.modified *'), function(elt) {
						var entry, entries = cacheDict[elt.innerHTML];
						do {
							entry = entries && entries.pop();
						} while (entry && document.contains(entry));
						entry && elt.parentNode.replaceChild(entry, elt);
					});
					typesetCallback = function() {
						cacheDict = {};
						Array.prototype.forEach.call(document.querySelectorAll('.classeur-preview-section .contains-mathjax'), function(elt) {
							var entries = cacheDict[elt.htmlBeforeTypeSet] || [];
							entries.push(elt);
							cacheDict[elt.htmlBeforeTypeSet] = entries;
						});
						cb();
					};
					UpdateMJ();
				});

				// Add new math block delimiter with priority 10
				var delimiter = '^[ \\t]*\\n\\$\\$[\\s\\S]*?\\$\\$|'; // $$ math block delimiters
				delimiter = '^[ \\t]*\\n\\\\\\\\[[\\s\\S]*?\\\\\\\\]|' + delimiter; // \\[ \\] math block delimiters
				delimiter = '^[ \\t]*\\n\\\\?\\\\begin\\{[a-z]*\\*?\\}[\\s\\S]*?\\\\end\\{[a-z]*\\*?\\}|' + delimiter; // \\begin{...} \\end{...} math block delimiters
				clEditorSvc.setSectionDelimiter(10, delimiter);
			} else {
				// Unset math block delimiter
				clEditorSvc.setSectionDelimiter(10, undefined);
			}

			clEditorSvc.setPrismOptions({
				maths: !!config
			});
		});

		var typesetCallback, UpdateMJ;

		function init() {
			var script = document.createElement('script');
			script.type = 'text/javascript';
			script.src = 'https://cdn.mathjax.org/mathjax/latest/MathJax.js?config=TeX-AMS_HTML&delayStartupUntil=configured';
			script.onload = onMathJaxLoaded;
			document.head.appendChild(script);
			isInit = true;
		}


		// Credit: math.stackexchange.com

		//
		//  The math is in blocks i through j, so
		//    collect it into one block and clear the others.
		//  Replace &, <, and > by named entities.
		//  For IE, put <br> at the ends of comments since IE removes \n.
		//  Clear the current math positions and store the index of the
		//    math, then push the math string onto the storage array.
		//
		function processMath(i, j, unescape) {
			var block = blocks.slice(i, j + 1).join("")
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
			for ( /* HUB.Browser.isMSIE && (block = block.replace(/(%[^\n]*)\n/g, "$1<br/>\n")) */ ; j > i;)
				blocks[j] = "", j--;
			blocks[i] = "@@" + math.length + "@@";
			unescape && (block = unescape(block));
			math.push(block);
			start = end = last = null;
		}

		function removeMath(text) {
			start = end = last = null;
			math = [];
			var unescape;
			if (/`/.test(text)) {
				text = text.replace(/~/g, "~T").replace(/(^|[^\\])(`+)([^\n]*?[^`\n])\2(?!`)/gm, function(text) {
					return text.replace(/\$/g, "~D");
				});
				unescape = function(text) {
					return text.replace(/~([TD])/g,
						function(match, n) {
							return {
								T: "~",
								D: "$"
							}[n];
						});
				};
			} else {
				unescape = function(text) {
					return text;
				};
			}
			blocks = split(text, splitDelimiter);
			for (var i = 1, m = blocks.length; i < m; i += 2) {
				var block = blocks[i];
				if ("@" === block.charAt(0)) {
					//
					//  Things that look like our math markers will get
					//  stored and then retrieved along with the math.
					//
					blocks[i] = "@@" + math.length + "@@";
					math.push(block);
				} else if (start) {
					// Ignore inline maths that are actually multiline (fixes #136)
					if (end == inline && block.charAt(0) == '\n') {
						if (last) {
							i = last;
							processMath(start, i, unescape);
						}
						start = end = last = null;
						braces = 0;
					}
					//
					//  If we are in math, look for the end delimiter,
					//    but don't go past double line breaks, and
					//    and balance braces within the math.
					//
					else if (block === end) {
						if (braces) {
							last = i;
						} else {
							processMath(start, i, unescape);
						}
					} else {
						if (block.match(/\n.*\n/)) {
							if (last) {
								i = last;
								processMath(start, i, unescape);
							}
							start = end = last = null;
							braces = 0;
						} else {
							if ("{" === block) {
								braces++;
							} else {
								"}" === block && braces && braces--;
							}
						}
					}
				} else {
					if (block === inline || "$$" === block) {
						start = i;
						end = block;
						braces = 0;
					} else {
						if ("begin" === block.substr(1, 5)) {
							start = i;
							end = "\\end" + block.substr(6);
							braces = 0;
						}
					}
				}

			}
			last && processMath(start, last, unescape);
			return unescape(blocks.join(""));
		}

		//
		//  Put back the math strings that were saved,
		//    and clear the math array (no need to keep it around).
		//
		function replaceMath(text) {
			text = text.replace(/@@(\d+)@@/g, function(match, n, pos) {
				var result = math[n];
				// Quick workaround to prevent processing "$10 $50 $100"
				if (result.match(/^\$(?!\$)/)) {
					var prefix = text[pos - 1] || '';
					var suffix = text[pos + match.length] || '';
					if (prefix.match(/\d/) || suffix.match(/\d/)) {
						return '\\$' + result.slice(1, -1) + '\\$';
					}
				}
				return result;
			});
			math = null;
			return text;
		}

		var ready = false,
			pending = false,
			inline = "$",
			blocks, start, end, last, braces, math;

		//
		//  The pattern for math delimiters and special symbols
		//    needed for searching for math in the page.
		//
		var splitDelimiter = /(\$\$?|\\(?:begin|end)\{[a-z]*\*?\}|\\[\\{}$]|[{}]|(?:\n\s*)+|@@\d+@@)/i;
		var split;

		if (3 === "aba".split(/(b)/).length) {
			split = function(text, delimiter) {
				return text.split(delimiter);
			};
		} else {
			split = function(text, delimiter) {
				var b = [],
					c;
				if (!delimiter.global) {
					c = delimiter.toString();
					var d = "";
					c = c.replace(/^\/(.*)\/([im]*)$/, function(a, c, b) {
						d = b;
						return c;
					});
					delimiter = RegExp(c, d + "g");
				}
				/*jshint -W084 */
				for (var e = delimiter.lastIndex = 0; c = delimiter.exec(text);) {
					b.push(text.substring(e, c.index));
					b.push.apply(b, c.slice(1));
					e = c.index + c[0].length;
				}
				b.push(text.substring(e));
				return b;
			};
		}

		function applyConfig() {
			if (!config || !$window.MathJax) {
				return;
			}
			$window.MathJax.Hub.Config(JSON.parse(JSON.stringify(config)));
			$window.MathJax.Hub.Configured();
		}

		function onMathJaxLoaded() {
			var MathJax = $window.MathJax;
			var HUB = $window.MathJax.Hub;
			applyConfig();

			//
			//  This is run to restart MathJax after it has finished
			//    the previous run (that may have been canceled)
			//
			function RestartMJ() {
				pending = false;
				HUB.cancelTypeset = false;
				HUB.Queue([
					"Typeset",
					HUB
				]);
				HUB.Queue(typesetCallback); //benweet
			}

			//
			//  When the preview changes, cancel MathJax and restart,
			//    if we haven't done that already.
			//
			UpdateMJ = function() {
				if (!pending /*benweet (we need to call our afterRefreshCallback) && ready */ ) {
					pending = true;
					HUB.Cancel();
					HUB.Queue(RestartMJ);
				}
			};

			//
			//  Runs after initial typeset
			//
			HUB.Queue(function() {
				ready = true;
				HUB.processUpdateTime = 50;
				HUB.Config({
					"HTML-CSS": {
						EqnChunk: 10,
						EqnChunkFactor: 1
					},
					SVG: {
						EqnChunk: 10,
						EqnChunkFactor: 1
					}
				});
			});

			if (!HUB.Cancel) {
				HUB.cancelTypeset = false;
				HUB.Register.StartupHook("HTML-CSS Jax Config", function() {
					var HTMLCSS = MathJax.OutputJax["HTML-CSS"],
						TRANSLATE = HTMLCSS.Translate;
					HTMLCSS.Augment({
						Translate: function(script, state) {
							if (HUB.cancelTypeset || state.cancelled)
								throw Error("MathJax Canceled");
							return TRANSLATE.call(HTMLCSS, script, state);
						}
					});
				});
				HUB.Register.StartupHook("SVG Jax Config", function() {
					var SVG = MathJax.OutputJax.SVG,
						TRANSLATE = SVG.Translate;
					SVG.Augment({
						Translate: function(script, state) {
							if (HUB.cancelTypeset || state.cancelled)
								throw Error("MathJax Canceled");
							return TRANSLATE.call(SVG,
								script, state);
						}
					});
				});
				HUB.Register.StartupHook("TeX Jax Config", function() {
					var TEX = MathJax.InputJax.TeX,
						TRANSLATE = TEX.Translate;
					TEX.Augment({
						Translate: function(script, state) {
							if (HUB.cancelTypeset || state.cancelled)
								throw Error("MathJax Canceled");
							return TRANSLATE.call(TEX, script, state);
						}
					});
				});
				var PROCESSERROR = HUB.processError;
				HUB.processError = function(error, state, type) {
					if ("MathJax Canceled" !== error.message)
						return PROCESSERROR.call(HUB, error, state, type);
					MathJax.Message.Clear(0, 0);
					state.jaxIDs = [];
					state.jax = {};
					state.scripts = [];
					state.i = state.j = 0;
					state.cancelled = true;
					return null;
				};
				HUB.Cancel = function() {
					this.cancelTypeset = true;
				};
			}
			/*jshint ignore:end */

		}

		return {
			restrict: 'A',
			link: function(scope) {
				function checkConfig() {
					var fileProperties = scope.currentFileDao.contentDao.properties;

					var newConfig = fileProperties['ext:mathjax'] === '1' ? (function() {
						var tex2jax, tex;
						try {
							tex2jax = JSON.parse(fileProperties['ext:mathjax:tex2jax']);
						} catch (e) {
							tex2jax = {};
						}
						try {
							tex = JSON.parse(fileProperties['ext:mathjax:tex']);
						} catch (e) {
							tex = {};
						}

						return {
							"HTML-CSS": {
								preferredFont: "TeX",
								availableFonts: [
									"TeX"
								],
								linebreaks: {
									automatic: true
								},
								EqnChunk: 10,
								imageFont: null
							},
							tex2jax: angular.extend({
								inlineMath: [
									[
										"$",
										"$"
									],
									[
										"\\\\(",
										"\\\\)"
									]
								],
								displayMath: [
									[
										"$$",
										"$$"
									],
									[
										"\\[",
										"\\]"
									]
								],
								processEscapes: true
							}, tex2jax),
							TeX: angular.extend({
								noUndefined: {
									attributes: {
										mathcolor: "red",
										mathbackground: "#FFEEEE",
										mathsize: "90%"
									}
								},
								Safe: {
									allow: {
										URLs: "safe",
										classes: "safe",
										cssIDs: "safe",
										styles: "safe",
										fontsize: "all"
									}
								}
							}, tex),
							messageStyle: "none"
						};
					})() : undefined;
					if (JSON.stringify(newConfig) !== JSON.stringify(config)) {
						config = newConfig;
						applyConfig();
						return true;
					}
				}

				checkConfig();
				scope.$watch('currentFileDao.contentDao.properties', function(properties) {
					if (properties && checkConfig()) {
						clEditorSvc.initConverter();
					}
				});
			}
		};
	});