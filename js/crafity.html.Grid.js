/*jslint browser: true, nomen: true, vars: true, white: true, evil: true */
/*globals numeral, moment*/

(function (crafity) {
	"use strict";

	(function (html) {

		function Grid(columns) {
			var self = this;
			var container = new html.Element("div").addClass("container").appendTo(this);
			var table = new html.Element("table").attr("cellspacing", "0").appendTo(container);
			var thead = new html.Element("thead").appendTo(table).addClass("header");
			var headerRow = new html.Element("tr").appendTo(thead);

			var tbody = new html.Element("tbody").appendTo(table);
			var TYPE_DATE = "Date";
			var TYPE_NUMBER = "Number";

			var EMPTY_VALUE = " ";
			var ASC = "ascending";
			var DESC = "descending";
			var sortHandler = null;

			var _rows = null;
			var _selectedRowId = null;

			var keys = {};
			container.addEventListener("keydown",
				function (e) {
					keys[e.keyCode] = true;
					switch (e.keyCode) {
						case 37:
						case 39:
						case 38:
						case 40: // Arrow keys
						case 32:
							e.preventDefault();
							break; // Space
						default:
							break; // do not block other keys
					}
				},
				false);
			container.addEventListener('keyup',
				function (e) {
					keys[e.keyCode] = false;
				},
				false);

			this.addClass("grid");

			/* Auxuliary methods */
			function sortRowsPerColumn(column, sortOrder) {
				var sortedRows = [];
				var valuesSortedPerColumn = _rows
					.map(function (row) {
						var value = row[column.property];
						if (typeof value === 'number' && isNaN(value)) {
							return "__NaN__";
						}
						return value;
					});
				valuesSortedPerColumn = valuesSortedPerColumn.filter(function onlyUnique(value, index) {
					return valuesSortedPerColumn.indexOf(value) === index;
				});

				var sortFunctions = {
					ascending: function (a, b) {
						if (a > b) {
							return 1;
						}
						if (a < b) {
							return -1;
						}
						return 0;
					},
					descending: function (a, b) {
						if (a > b) {
							return -1;
						}
						if (a < b) {
							return 1;
						}
						return 0;
					}
				};

				valuesSortedPerColumn.sort(sortFunctions[sortOrder]);

				valuesSortedPerColumn.forEach(function (sortedRowValue) {
					_rows.forEach(function (row) {

						if (row[column.property] === sortedRowValue ||
							(sortedRowValue === "__NaN__"
								&& typeof row[column.property] === 'number'
								&& isNaN(row[column.property]))) {
							sortedRows.push(row);
						}
					});
				});

				return sortedRows;
			}

			function addRows(rows) {
				rows.forEach(self.addRow);
			}

			/* Public methods */
			this.addColumn = function (column) {
				var th = new html.Element("th").addClass("sortable");
				var stickyTH = new html.Element("div");
				var textSpan = new html.Element("span");

				stickyTH.append(textSpan.text(column.name)).addClass("sticky").appendTo(th);

				if (column.sortable) {
					th.addClass(column.sortable); // asc or desc

					// event handler
					stickyTH.addEventListener(crafity.core.events.click, function () {
						var lastSortOrder;
						var newSortOrder;

						if (th.hasClass(ASC)) {
							lastSortOrder = ASC;
						}
						else if (th.hasClass(DESC)) {
							lastSortOrder = DESC;
						}

						headerRow.children().forEach(function (thElement) {
							thElement.removeClass(ASC).removeClass(DESC);
						});

						if (lastSortOrder === ASC) {
							th.addClass(newSortOrder = DESC);
						}
						else if (lastSortOrder === DESC) {
							th.addClass(newSortOrder = ASC);
						}
						else {
							th.addClass(newSortOrder = ASC); // default
						}

						if (sortHandler) {
							return sortHandler({ column: column, order: newSortOrder });
						}

						var sortedRows = sortRowsPerColumn(column, newSortOrder);
						self.clearRows();
						addRows(sortedRows);

					});
				}

				th.addClass("column").appendTo(headerRow);
			};

			this.addColumns = function (columns) {
				if (!columns) {
					throw new Error("Argument 'columns' is required");
				}
				columns.forEach(self.addColumn);
			};

			this.clearColumns = function () {
				headerRow.clear();
			};

			this.addRow = function (row) {
				var rowElement = new html.Element("tr").appendTo(tbody).addClass("row");

				function highlightRow() {
					tbody.children().forEach(function (child) {
						child.removeClass("selected");
					});
					rowElement.addClass("selected");
					self.emit("selectedGridRow", row);
				}

				// Highlight visually the selected row in two cases:
				// 1. via databinding with new coming rows
				if (_selectedRowId !== null && _selectedRowId === row.Id) {
					highlightRow();
				}
				// 2. via the GUI on user click 
				rowElement.addEventListener(crafity.core.events.click, function (e) {
					_selectedRowId = row.Id;
					highlightRow();
				});

				function open(key, e) {
					highlightRow();
					self.emit("open", row);
					e && e.preventDefault();
					return false;
				}

				rowElement.attr("tabindex", -1);
				crafity.keyboard.attach(rowElement).on("enter", open);
				rowElement.addEventListener("dblclick", open);

				columns.forEach(function (column) {
					var td = new html.Element("td").addClass("cell").appendTo(rowElement);

					if (column.options) { td.addClass("string"); }
					else { td.addClass(column.type.toLowerCase()); }

					var actualValue = row[column.property];

					if (actualValue === undefined || actualValue === null) {
						actualValue = EMPTY_VALUE;
					}
					else if (column.type === TYPE_NUMBER && typeof actualValue === "number" && !isNaN(actualValue)) {
						if (actualValue < 0) { td.addClass("negative"); }
						else { td.addClass("positive"); }

						if (column.format) {
							actualValue = numeral(actualValue).format(column.format);
						}
					}
					else if (column.type === TYPE_DATE) {
						if (column.format) {
							actualValue = moment(actualValue).format(column.format);
						}
					}
					var instantiate;

					if (column.editable) {
						instantiate = new Function("return new " + column.editable.control + "()");
						var editControl = instantiate();
						if (column.options) {
							editControl.options(column.options);
						}
						editControl.value(actualValue);
						if (column.editable.events && column.editable.events.length) {
							column.editable.events.forEach(function (event) {
								Object.keys(event).forEach(function (eventName) {
									editControl.on(eventName, function () {
										var args = Array.prototype.slice.apply(arguments);
										self.emit.apply(self, [event[eventName], column, row].concat(args));
									});
								});
							});
						}
						td.append(editControl);
					}
					else if (column.clickable) {
						instantiate = new Function("return new " + column.clickable.control + "()");
						var clickControl = instantiate();
						throw new Error("Not implemented");
						if (column.options) { clickControl.options(column.options); }
						clickControl.text(actualValue.toString());
						//						if (column.editable.events && column.editable.events.length) {
						//							column.editable.events.forEach(function (event) {
						//								clickControl.on(event, function () {
						//									var args = Array.prototype.slice.apply(arguments);
						//									self.emit.apply(self, [event, column, row].concat(args));
						//								});
						//							});
						//						}
						td.append(clickControl);
					}
					else {
						td.text(actualValue.toString());
					}

				});
			};

			this.addRows = function (rows) {
				this.clearRows();

				if (!columns || !columns.length) {
					return;
				}

				_rows = rows;
				var sortedRows = [];
				var sorted = false;

				// 1. sort rows
				// NB this will sort the last winning sortable column in the array of columns
				!sortHandler && columns.some(function (column) {
					if (column.sortable) {
						sorted = true;
						sortedRows = sortRowsPerColumn(column, column.sortable);
						return true;
					}
					return false;
				});
				if (!sorted) {
					sortedRows = rows;
				}

				// 2. add rows
				addRows(sortedRows);
			};

			this.clearRows = function () {
				tbody.clear();
				new html.Element("tr").appendTo(tbody).addClass("row top-spacer");
			};

			this.clearRows();

			this.onsort = function (handler) {
				sortHandler = handler;
				return this;
			};

			if (columns) {
				this.addColumns(columns);
			}
		}

		Grid.prototype = new html.Element("div");
		html.Grid = Grid;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
