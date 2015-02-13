function drawLineGraph(time_data) {
    var parseDate = d3.time.format.iso.parse;

    var data = time_data.map(function (d) {
        return [parseDate(d[0]), d[1]]
    });

    var margin = {top: 20, right: 20, bottom: 70, left: 50},
        width = 400 - margin.left - margin.right,
        height = 300 - margin.top - margin.bottom;

    var x = d3.time.scale()
        .range([0, width]);

    var y = d3.scale.linear()
        .range([height, 0]);

    var xAxis = d3.svg.axis()
        .scale(x)
        .ticks(9)
        .orient("bottom");

    var yAxis = d3.svg.axis()
        .scale(y)
        .orient("left");

    var line = d3.svg.line()
        .x(function (d) {
            return x(d[0]);
        })
        .y(function (d) {
            return y(d[1]);
        });

    var svg = d3.select("#line_graph")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    x.domain(d3.extent(data, function (d) {
        return d[0];
    }));
    y.domain(d3.extent(data, function (d) {
        return d[1];
    }));

    svg.append('g')
        .attr('class', 'x axis')
        .attr('transform', 'translate(0,' + height + ')')
        .call(xAxis)
        .selectAll('text')
        .style('text-anchor', 'end')
        .attr('dx', '-.8em')
        .attr('dy', '.15em')
        .attr('transform', function (d) {
            return 'rotate(-65)'
        });

    svg.append('g')
        .attr('class', 'y axis')
//        .attr('transform', 'translate(' + (margin.left) + ',0)')
        .call(yAxis);

    svg.selectAll('dot')
        .data(data)
        .enter()
        .append('circle')
        .attr('r', 3.5)
        .attr('cx', function (d) {
            return x(d[0])
        })
        .attr('cy', function (d) {
            return y(d[1])
        });

    svg.append('path')
        .datum(data)
        .attr('d', line)
        .attr('stroke', 'blue')
        .attr('stroke-width', 2)
        .attr('fill', 'none');

}

function drawBarGraph(bar_data) {
}

function drawMap(map_data) {

    var map = L.map('vis_map', {
        dragging: true,
        zoom: 14,
        zoomControl: false,
        doubleClickZoom: false,
        attributionControl: false
    });

    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {}).addTo(map);

    var sw_lat = parseFloat(map_data[0][1]);
    var sw_lng = parseFloat(map_data[0][0]);
    var ne_lat = parseFloat(map_data[0][1]);
    var ne_lng = parseFloat(map_data[0][0]);

    for (i = 0; i < map_data.length; i++) {
        var location = map_data[i];
        var lng = parseFloat(location[0]);
        if (lng < sw_lng) {
            sw_lng = lng;
        } else if (lng > ne_lng) {
            ne_lng = lng;
        }
        var lat = parseFloat(location[1]);
        if (lat < sw_lat) {
            sw_lat = lat;
        } else if (lat > ne_lat) {
            ne_lat = lat;
        }
        // stored lon/lat in revisit, switch around
        var marker = new L.marker([lat, lng], {
            riseOnHover: true
        });
        marker.options.icon = new L.icon({iconUrl: "/static/img/icons/selected-point.png", iconAnchor: [15, 48]});

        var answers = JSON.parse(map_data[i][2]).answers;
        var submission_text = "<ul>";
        for (j = 0; j < answers.length; j++) {
            var ans = answers[j];
            submission_text += "<li><strong>" + ans.sequence_number + ". " + ans.question_title + "</strong><br />" + ans.answer + "</li>";
        }
        submission_text += "</ul";

        marker.bindPopup(submission_text);

        marker.addTo(map);
    }

    map.fitBounds([
        [sw_lat, sw_lng],
        [ne_lat, ne_lng]
    ]);
}
