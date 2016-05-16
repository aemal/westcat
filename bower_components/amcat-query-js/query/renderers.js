define([
    "jquery", "renderjson", "query/utils/aggregation", "query/utils/poll", "moment",
    "query/utils/articlemodal", "query/valuerenderers", "pnotify", "query/api",
    "highcharts.core", "highcharts.data", "highcharts.heatmap", "highcharts.exporting",
    "papaparse"
], function($, renderjson, Aggregation, Poll, moment, articles_popup, value_renderers, PNotify, API){
    "use strict";
    var renderers = {};
    API = API();

    function getXType(axis){
        var intervals = ["year", "quarter", "month", "week", "day", "date"];
        return (intervals.indexOf(axis) === -1) ? "category" : "datetime";
    }

    function getYType(axis){
        if(axis === "date" || axis === "medium" || axis === "term" || axis === "set" || axis === "total" || axis === "count"){
            return "Number of articles";
        }

        if(axis.startsWith("avg(") && axis.endsWith(")")){
            return "Average";
        }

        return axis;
    }

    function getSerie(form_data, aggr, x_key, x_type){
        var serie = { obj: x_key, name: value_renderers.getRenderer(form_data["y_axis"])(x_key) };

        if(x_type === "datetime"){
            serie.data = $.map(aggr.columns, function(column){
                return [[Date.parse(column), aggr.get(x_key).get(column) || 0]];
            });
        } else{
            serie.data = $.map(aggr.columns, function(column){
                return aggr.get(x_key).get(column) || 0;
            });
        }
        serie.data.sort(function(a, b){
            return a[0] - b[0];
        })
        return serie;
    }

    function bottom(callback){
        $(window).scroll(function(){
            if($(window).scrollTop() + $(window).height() == $(document).height()){
                $(window).off("scroll");
                callback();
            }
        });
    }

    function get_accepted_mimetypes(){
        return $.map(renderers, function(_, mimetype){
            return mimetype;
        });
    }

    function load_extra_summary(){
        var result = $("#result");
        result.find(".loading").show();
        var data = result.find(".row.summary").data("form");
        data["aggregations"] = false;
        data["offset"] = result.find(".articles > li").length;

        var url = API.getActionUrl(
            "summary", $("#query-screen").data("project"),
            data.codingjobs, data.articlesets);

        $.ajax({
            type: "POST", dataType: "json",
            url: url,
            data: data,
            headers: { "X-Available-Renderers": get_accepted_mimetypes().join(",") },
            traditional: true
        }).done(function(data){
            // Form accepted, we've been given a task uuid
            Poll(data.uuid).result(function(data){
                result.find(".loading").hide();
                var articles = $(".articles > li", $(data));
                if(articles.length === 0) return;
                result.find(".articles").append(articles);
                bottom(load_extra_summary);
            });
        })

    }

    return $.extend(renderers, {
        "application/json+debug": function(form_data, container, data){
            renderjson.set_icons('', '');
            renderjson.set_show_to_level("all");
            var text = $(renderjson(data)).text().replace(/{...}|\[ ... \]/g, "");
            var code = $("<code class='json'>").text(text);
            $(container).append($('<pre style="background-color:#f8f8ff;">').append(code));
            hljs.highlightBlock($("pre", container).get(0));
        },
        "application/json+clustermap+table": function(form_data, container, data){
            var table = renderers["text/csv+table"](form_data, container, data.csv);
            table.addClass("table-hover");

            $("tr", table).click(function(event){
                // Find column indices of relevant queries
                var columns = [];
                var tds = $("td", $(event.currentTarget)).toArray();
                tds.pop();

                $.each(tds, function(i, td){
                    if($(td).text() == "1"){
                        columns.push(i);
                    }
                });

                // Resolve queries
                var queries = $.map(columns, function(column){
                    var query = $($("thead > th", table)[column]).text();
                    return data.queries[query];
                });

                articles_popup().show(form_data, {
                    query: "(" + queries.join(") AND (") + ")"
                });
            }).css("cursor", "pointer");
        },
        "text/csv+table": function(form_data, container, data){
            var table_data = Papa.parse(data, { skipEmptyLines: true }).data;
            return renderers["application/json+table"](form_data, container, table_data);
        },
        "application/json+tables": function(form_data, container, data){
            $.map(data, function(table){
                var table_name = table[0];
                var table_data = table[1];
                var table_container = $("<div>");
                renderers["application/json+table"](form_data, table_container, table_data);
                $(table_container).prepend($("<h1>").text(table_name));
                $(container).append(table_container);
            });

            return container;
        },
        "application/json+table": function(form_data, container, table_data){
            var thead = $("<thead>").append(
                $.map(table_data[0], function(label){
                    return $("<th>").text(label);
                })
            );

            var tbody = $("<tbody>").append(
                $.map(table_data.slice(1), function(row){
                    return $("<tr>").append(
                        $.map(row, function(value){
                            return $("<td>").text(value);
                        })
                    )
                })
            );

            var table = $("<table class='table table-striped'>").append([thead, tbody]);
            container.append(table);
            return table;
        },
        "application/json+crosstables": function(form_data, container, data){
            renderers["application/json+tables"](form_data, container, data);
            $("tr td:first-child", container).css("font-weight", "bold");
        },
        "application/json+clustermap": function(form_data, container, data){
            var img = $("<img class='img-responsive'>")
                .attr("src", "data:image/png;base64," + data.image)
                .attr("usemap", "#clustermap");

            var map = $("<map>").attr("name", "clustermap");

            // Store for each clickable coordinate its article id
            var area;
            $.map(data.coords, function(coord){
                area = $("<area>");
                area.attr("shape", "rect");
                area.attr("coords", coord.coords.join(","));
                area.attr("article_id", coord.article_id);
                area.data("article_id", coord.article_id);
                map.append(area);
            });

            // Add query for cluster each article is in
            $.each(data.clusters, function(_, cluster){
                $.each(cluster.articles, function(_, article_id){
                    map.find("[article_id=" + article_id + "]").data("query", cluster.query);
                });
            });

            // Register click event for each article
            $("area", map).click(function(event){
                articles_popup().show(form_data, {
                    term: {
                        label: $(event.currentTarget).data("query")
                    }
                })
            });

            container.append(img).append(map);
        },
        "application/json+image+svg+multiple": function(form_data, container, data){
            $.map(data, function(table){
                var table_container = $("<div>");
                renderers["image/svg"](form_data, table_container, table[1]);
                $(table_container).prepend($("<h1>").text(table[0]));
                $(container).append(table_container);
            });

            return container;
        },
        "image/svg": function(form_data, container, data){
            return container.html(data);
        },
        "image/png+base64": function(form_data, container, data){
            container.append($("<img class='img-responsive'>").attr("src", "data:image/png;base64," + data));
        },
        /**
         * Inserts given html into container, without processing it further.
         */
        "text/html": function(form_data, container, data){
            return container.html(data);
        },
        "text/html+summary": function(form_data, container, data){
            renderers["text/html"](form_data, container, data);
            bottom(load_extra_summary);
        },

        /**
         * Renders aggregation as stacked column chart
         *   http://www.highcharts.com/demo/heatmap
         */
        "text/json+aggregation+heatmap": function(form_data, container, data){
            var aggregation = Aggregation(data);
            var heatmap_data = [];

            data.forEach(function(row, rowIdx){
                var rowFields = row[1];
                rowFields.forEach(function(field){
                    var fieldData = field[0];
                    var fieldValue = field[1];
                    var fieldIdx = aggregation.columns.findIndex(function(item){
                        return item.id == fieldData.id;
                    });

                    heatmap_data.push([rowIdx, fieldIdx, fieldValue])
                });
            });
            var x_renderer = value_renderers.getRenderer(form_data["x_axis"]);
            var y_renderer = value_renderers.getRenderer(form_data["y_axis"]);

            container.highcharts({
                title: "",
                chart: { type: 'heatmap' },
                colorAxis: {
                    min: 0,
                    minColor: '#FFFFFF',
                    maxColor: Highcharts.getOptions().colors[0]
                },
                xAxis: {
                    allowDecimals: false,
                    categories: $.map(aggregation.rows, x_renderer)
                },
                yAxis: {
                    allowDecimals: false,
                    categories: $.map(aggregation.columns, y_renderer)
                },
                series: [{
                    name: "x",
                    data: heatmap_data
                }]
            });
        },

        "text/json+aggregation+line": function(form_data, container, data){
            return renderers["text/json+aggregation+barplot"](form_data, container, data, "line");
        },


        "text/json+aggregation+scatter": function(form_data, container, data){
            return renderers["text/json+aggregation+barplot"](form_data, container, data, "scatter");
        },

        "text/json+aggregation+codings+barplot": function(form_data, container, data, type){
            type = (type === undefined) ? "column" : type;

            var primary = form_data.primary;
            var secondary = form_data.secondary;
            var value1 = form_data.value1;
            var value2 = form_data.value2;


            var chart = {
                title: "",
                tooltip: {
                    shared: true
                },
                chart: {
                    zoomType: 'xy',
                    type: type
                },
                xAxis: {
                    allowDecimals: false,
                    type: getXType(primary),
                },
                yAxis: [
                    {
                        allowDecimals: false,
                        title: {
                            "text": getYType(value1)
                        }
                    }
                ],
                series: [],
                plotOptions: {
                    series: {
                        events: {
                            click: function(event){
                                // Do things :)
                            }
                        }
                    }
                }
            };

            if(primary && !secondary && value1 && !value2){
                // 1 aggr + 1 value
                chart.series.push({
                    name: primary,
                    data: $(data).map(function(i, point){
                        return [[point[0][0].label || point[0][0], point[1][0]]];
                    })
                });

                chart.legend = {
                    enabled: false
                };
            } else if(primary && secondary){
                // 2 aggr + 1 value
                var series = {};
                var prim_val, sec_val, val;

                data.forEach(function(point){
                    sec_val = point[0][1];
                    series[sec_val.id || sec_val] = {
                        name: sec_val.label || sec_val,
                        data: []
                    };
                });

                data.forEach(function(point){
                    prim_val = point[0][0];
                    sec_val = point[0][1];
                    val = point[1][0];
                    series[sec_val.id || sec_val].data.push([prim_val.label || prim_val, val]);
                });

                chart.series = $.map(series, function(val){
                    return val;
                });
            } else{
                // 1 aggr + 2 value

                // Add bars (first value)
                chart.series.push({
                    name: $("#id_value1 [value='{v}']".format({v: value1})).text(),
                    data: $(data).map(function(i, point){
                        if(point[1][0] === null) return null;
                        return [[point[0][0].label || point[0][0], point[1][0]]];
                    })
                });

                // Add line (second value)
                chart.series.push({
                    name: $("#id_value2 [value='{v}']".format({v: value2})).text(),
                    yAxis: 1,
                    type: "spline",
                    data: $(data).map(function(i, point){
                        if(point[1][1] === null) return null;
                        return [[point[0][0].label || point[0][0], point[1][1]]];
                    })
                });

                // Add second y-axis
                chart.yAxis.push({
                    title: { "text": getYType(value2)},
                    opposite: true
                });
            }

            container.highcharts(chart);
        },

        "text/json+aggregation+codings+line": function(form_data, container, data){
            return renderers["text/json+aggregation+codings+barplot"](form_data, container, data, "line");
        },


        "text/json+aggregation+codings+scatter": function(form_data, container, data){
            return renderers["text/json+aggregation+codings+barplot"](form_data, container, data, "scatter");
        },


        /* Renders barplot. If a second y axis is selected, this function will call the script
         * again, asking for a second aggregation. (This feels like a bit of a hack [and it
         * probably is], but we can prevent 'compex' aggreagtion code server side.
         */
        "text/json+aggregation+barplot": function(form_data, container, data, type){
            var x_type = getXType(form_data["x_axis"]);
            var y_type = getYType(form_data["y_axis"]);
            var aggregation = Aggregation(data).transpose();
            var columns = aggregation.columns;

            type = (type === undefined) ? "column" : type;

            var tooltipOptions = {shared: true};
            tooltipOptions.pointFormatter = function(default_format){
                var point = $.extend({}, this);
                var date = "";
                if(x_type === "datetime"){
                    point.x = Highcharts.dateFormat("%Y-%m-%d", point.x);
                }
                return Highcharts.format(default_format, {point: point, series: point.series, formatted_date: date});
            };



            var chart = {
                title: "",
                tooltip: tooltipOptions,
                chart: { zoomType: 'xy', type: type },
                xAxis: { allowDecimals: false, type: x_type },
                yAxis: [
                    {
                        allowDecimals: false,
                        title: {
                            "text": y_type
                        }
                    }
                ],
                series: $.map(aggregation.rows, function(x_key){
                    return getSerie(form_data, aggregation, x_key, x_type);
                }),
                plotOptions: {
                    series: {
                        events: {
                            click: function(event){
                                var x_type = form_data["x_axis"];
                                var y_type = form_data["y_axis"];

                                var filters = {};
                                filters[y_type] = event.point.series.options.obj;
                                filters[x_type] = x_type == "date"
                                    ? event.point.x
                                    : columns[event.point.x];

                                articles_popup().show(form_data, filters);
                            }
                        }
                    }
                }
            };

            // We will fetch the second y-axis again using polling
            var y_axis_2 = form_data["y_axis_2"];
            var y_axis_2_option = $("option[value={y}]".format({ y: y_axis_2 }));
            var y_axis_2_label = $(y_axis_2_option.get(0)).text();

            if(y_axis_2 !== "" && y_axis_2 !== undefined){
                chart.yAxis.push({
                    title: { "text": y_axis_2_label },
                    opposite: true
                });

                chart.chart.events = {
                    load: function(){
                        // Load extra aggregation and draw it onscreen.
                        var new_form_data = $.extend({}, form_data, { y_axis: form_data.y_axis_2 });

                        var url = API.getActionUrl(
                            "aggregation", $("#query-screen").data("project"),
                            form_data.codingjobs, form_data.articlesets
                        );

                        $.ajax({
                            type: "POST",
                            dataType: "json",
                            url: url,
                            data: new_form_data,
                            headers: { "X-Available-Renderers": get_accepted_mimetypes().join(",") },
                            traditional: true
                        }).done(function(data){
                            // Form accepted, we've been given a task uuid
                            Poll(data.uuid).result(function(data){
                                var datapoints;
                                if(y_axis_2 === "total"){
                                    datapoints = data;
                                } else{
                                    var aggregation = Aggregation(data).transpose();
                                    // TODO: Accept multiple series
                                    datapoints = aggregation.get(aggregation.rows[0]).entries();
                                }

                                this.addSeries({
                                    name: y_axis_2_label,
                                    yAxis: 1,
                                    type: "spline",
                                    data: datapoints
                                })
                            }.bind(this));
                        }.bind(this))

                    }
                };
            }


            // We need category labels if x_axis is not of type datetime
            if(x_type !== "datetime"){
                var renderer = value_renderers.getRenderer(form_data["x_axis"]);
                chart.xAxis.categories = $.map(columns, renderer);
            }

            container.highcharts(chart);

            // Show render warning
            var context_menu = $("g.highcharts-button > title:contains('context')", container).parent();
            var notification = {
                text: 'If you decide to export an image, keep in mind the data is sent to highcharts.com' +
                ' for rendering purposes. ',
                type: 'info',
                icon: 'ui-icon ui-icon-locked',
                auto_display: false,
                history: false,
                stack: false,
                animate_speed: 0,
                opacity: 0.9,
                hide: false
            };

            $("title", context_menu).text("");
            var pnotify = new PNotify(notification);

            $(context_menu).mouseenter(function(event){
                pnotify.get().css({
                    'top': event.clientY + 12,
                    'left': event.clientX + 12 - 320
                });

                pnotify.open();
            }).mouseleave(function(){
                pnotify.remove();
            }).click(function(){
                pnotify.remove();
            });
        },

        /**
         * Renders aggregation as table. Each 'th' element has a data property 'value',
         * which can be used to access the original server data for that particular
         * element. For example, for a medium:
         *
         *    { id: 1, label: "test" }
         *
         * or a date:
         *
         *    1371160800000
         */
        "text/json+aggregation+table": function(form_data, container, data){
            var row_template, table, thead, tbody, renderer;
            var aggregation = Aggregation(data);

            // Adding header
            thead = $("<thead>").append($("<th>"));
            renderer = value_renderers.getRenderer(form_data["y_axis"]);
            $.map(aggregation.columns, function(column){
                thead.append($("<th>").text(renderer(column)).data("value", column));
            });

            // Adding rows. Using row templates to prevent lots of small inserts
            row_template = (new Array(aggregation.columns.length + 1)).join("<td></td>");
            row_template = "<tr><th></th>" + row_template + "</tr>";

            tbody = $("<tbody>");
            renderer = value_renderers.getRenderer(form_data["x_axis"]);

            $.map(aggregation.rows, function(row){
                var row_element = $(row_template);
                row_element.find("th").text(renderer(row)).data("value", row);

                var value;
                $.each(aggregation.columns, function(i, column){
                    // Check for float / integer. And wtf javascript, why not float type?!
                    value = aggregation.get(row).get(column) || 0;
                    value = (value % 1 === 0) ? value : value.toFixed(2);
                    row_element.find("td").eq(i).text(value);
                });

                tbody.append(row_element);
            });

            // Putting it together
            table = $("<table class='aggregation dataTable table table-striped'>");
            table.append(thead).append(tbody);
            container.html(table);

            // Register click event (on table)
            table.click(function(event){
                var td = $(event.target);
                if(td.prop("tagName") === "TD"){
                    var x_type = form_data["x_axis"];
                    var y_type = form_data["y_axis"];

                    var col = td.closest('table').find('thead th').eq(td.index());
                    var row = td.parent().children().eq(0);

                    var filters = {};
                    filters[x_type] = row.data('value');
                    filters[y_type] = col.data('value');
                    articles_popup().show(form_data, filters);
                }
            });

            return table;
        }
    });
});

